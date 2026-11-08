begin;

-- Normalization matches src/features/uploads/deduplicate.js. Hash long OCR text for a bounded index.
create function public.question_key(p_question jsonb)
returns text language sql immutable strict set search_path = '' as $$
  select (case when coalesce((p_question->>'isDocument')::boolean, false) then 'text:' else 'question:' end)
    || btrim(regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(replace(replace(regexp_replace(normalize(
            case when coalesce((p_question->>'isDocument')::boolean, false)
              then coalesce(nullif(p_question->>'rawText', ''), p_question->>'question', '')
              else coalesce(p_question->>'question', '') end, NFD), U&'[\0300-\036f]', '', 'g'), 'đ', 'd'), 'Đ', 'D')),
          '^\s*etc\s*[-–]?\s*otc\s*/?\s*', '', 'i'),
        '^\s*cau\s+\d+(?:\s*/\s*\d+)?\s*[:.)-]\s*', '', 'i'),
      '[^a-z0-9]+', ' ', 'g'));
$$;
create function public.question_fingerprint(p_question jsonb)
returns text language sql immutable strict set search_path = '' as $$
  select encode(sha256(convert_to(public.question_key(p_question), 'UTF8')), 'hex');
$$;

create table public.builtin_questions (
  id integer primary key,
  payload jsonb not null,
  fingerprint text generated always as (public.question_fingerprint(payload)) stored unique
);
create table public.documents (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 240),
  image_path text not null unique,
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  raw_text text not null check (char_length(raw_text) between 3 and 100000),
  created_at timestamptz not null default now(),
  unique (owner_id, digest),
  unique (id, owner_id)
);
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position >= 0),
  payload jsonb not null,
  fingerprint text generated always as (public.question_fingerprint(payload)) stored,
  foreign key (document_id, owner_id) references public.documents(id, owner_id) on delete cascade,
  unique (owner_id, fingerprint),
  unique (document_id, position)
);
create index documents_owner_created on public.documents(owner_id, created_at desc, id);
create index questions_document on public.questions(document_id);

alter table public.builtin_questions enable row level security;
alter table public.documents enable row level security;
alter table public.questions enable row level security;
create policy builtin_read on public.builtin_questions for select to authenticated using (true);
create policy documents_read on public.documents for select to authenticated using ((select auth.uid()) = owner_id);
create policy questions_read on public.questions for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.builtin_questions, public.documents, public.questions from anon, authenticated;
grant select on public.builtin_questions, public.documents, public.questions to authenticated;

create function public.validate_question(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare option_value jsonb; correct_index integer;
begin
  if p is null or jsonb_typeof(p) <> 'object'
    or jsonb_typeof(p->'question') is distinct from 'string'
    or char_length(btrim(p->>'question')) not between 1 and 10000
    or jsonb_typeof(p->'options') is distinct from 'array' then
    raise exception 'Nội dung câu hỏi không hợp lệ.';
  end if;
  if jsonb_array_length(p->'options') > 10 then raise exception 'Tối đa 10 lựa chọn.'; end if;
  for option_value in select value from jsonb_array_elements(p->'options') loop
    if jsonb_typeof(option_value) <> 'string' or char_length(option_value #>> '{}') > 5000 then
      raise exception 'Lựa chọn không hợp lệ.';
    end if;
  end loop;
  if coalesce(p->>'correct', '-1') !~ '^-?[0-9]+$' then raise exception 'Đáp án không hợp lệ.'; end if;
  correct_index := coalesce((p->>'correct')::integer, -1);
  if correct_index < -1 or correct_index >= jsonb_array_length(p->'options') then raise exception 'Đáp án không hợp lệ.'; end if;
  if char_length(coalesce(p->>'rawText', '')) > 100000 then raise exception 'Văn bản quá dài.'; end if;
  return jsonb_build_object(
    'question', btrim(p->>'question'), 'options', p->'options', 'correct', correct_index,
    'originalNumber', case when p->>'originalNumber' ~ '^[0-9]{1,6}$' then (p->>'originalNumber')::integer else null end,
    'isDocument', jsonb_array_length(p->'options') = 0,
    'rawText', coalesce(p->>'rawText', ''), 'edited', coalesce((p->>'edited')::boolean, false),
    'ocrConfidence', case when p->>'ocrConfidence' ~ '^[0-9]{1,3}$' then least(100, (p->>'ocrConfidence')::integer) else 0 end
  );
end;
$$;

-- RPCs are the only write interface. Lock by user to serialize concurrent imports and edits.
create function public.import_document(
  p_id uuid, p_filename text, p_image_path text, p_mime text, p_digest text,
  p_raw_text text, p_questions jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid(); item jsonb; clean jsonb; existing jsonb; key text;
  duplicates jsonb := '[]'::jsonb; position_index integer := 0;
  previous uuid; question_id uuid;
begin
  if owner is null then raise exception 'Đăng nhập để lưu dữ liệu.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text, 0));
  if p_image_path is null or p_image_path <> (owner::text || '/' || p_id::text || '.' ||
     case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else '?' end) then
    raise exception 'Đường dẫn ảnh không hợp lệ.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'test-images' and name = p_image_path) then
    raise exception 'Không tìm thấy ảnh đã tải lên.';
  end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then raise exception 'Danh sách câu hỏi không hợp lệ.'; end if;
  if jsonb_array_length(p_questions) not between 1 and 100 then raise exception 'Tối đa 100 câu trong một ảnh.'; end if;
  select id into previous from public.documents where owner_id = owner and digest = p_digest;
  if previous is not null then
    select coalesce(jsonb_agg(jsonb_build_object('existing', payload || jsonb_build_object('id',id), 'incoming',payload)), '[]'::jsonb)
      into duplicates from public.questions where document_id = previous and owner_id = owner;
    return jsonb_build_object('documentId', null, 'duplicates', duplicates);
  end if;
  insert into public.documents(id,owner_id,filename,image_path,mime,digest,raw_text)
    values(p_id,owner,p_filename,p_image_path,p_mime,p_digest,p_raw_text);
  for item in select value from jsonb_array_elements(p_questions) loop
    clean := public.validate_question(item);
    key := public.question_fingerprint(clean);
    existing := null;
    select payload || jsonb_build_object('id', id) into existing from public.builtin_questions where fingerprint = key;
    if existing is null then
      select payload || jsonb_build_object('id', id) into existing from public.questions where owner_id = owner and fingerprint = key;
    end if;
    if existing is not null then
      duplicates := duplicates || jsonb_build_array(jsonb_build_object('existing', existing, 'incoming', clean));
    else
      insert into public.questions(document_id,owner_id,position,payload)
        values(p_id,owner,position_index,clean) returning id into question_id;
      position_index := position_index + 1;
    end if;
  end loop;
  if position_index = 0 then delete from public.documents where id = p_id and owner_id = owner; end if;
  return jsonb_build_object('documentId', case when position_index > 0 then p_id else null end, 'duplicates', duplicates);
end;
$$;

create function public.update_document(p_id uuid, p_questions jsonb, p_raw_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); item jsonb; clean jsonb; question_id uuid; key text; seen uuid[] := '{}';
begin
  if owner is null then raise exception 'Đăng nhập để sửa dữ liệu.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text, 0));
  if not exists (select 1 from public.documents where id = p_id and owner_id = owner) then raise exception 'Không tìm thấy tài liệu.'; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then raise exception 'Câu hỏi không hợp lệ.'; end if;
  if jsonb_array_length(p_questions) <> (select count(*) from public.questions where document_id = p_id and owner_id = owner) then
    raise exception 'Không được thêm hoặc xóa câu hỏi qua thao tác sửa.';
  end if;
  for item in select value from jsonb_array_elements(p_questions) loop
    question_id := (item->>'id')::uuid;
    if question_id is null or question_id = any(seen) or not exists (
      select 1 from public.questions where id = question_id and document_id = p_id and owner_id = owner
    ) then raise exception 'Câu hỏi không thuộc tài liệu này.'; end if;
    seen := array_append(seen, question_id);
    clean := public.validate_question(item) || '{"edited":true}'::jsonb;
    key := public.question_fingerprint(clean);
    if exists (select 1 from public.builtin_questions where fingerprint = key)
      or exists (select 1 from public.questions where owner_id = owner and fingerprint = key and id <> question_id) then
      raise exception 'Câu hỏi này đã có trong dữ liệu. Không lưu bản trùng.';
    end if;
    update public.questions set payload = clean where id = question_id and owner_id = owner;
  end loop;
  update public.documents set raw_text = p_raw_text where id = p_id and owner_id = owner;
end;
$$;
create function public.delete_document(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid();
begin
  if owner is null then raise exception 'Đăng nhập để xóa dữ liệu.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text, 0));
  delete from public.documents where id = p_id and owner_id = owner;
  if not found then raise exception 'Không tìm thấy tài liệu.'; end if;
end;
$$;
revoke all on function public.validate_question(jsonb) from public;
revoke all on function public.import_document(uuid,text,text,text,text,text,jsonb) from public;
revoke all on function public.update_document(uuid,jsonb,text) from public;
revoke all on function public.delete_document(uuid) from public;
grant execute on function public.import_document(uuid,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.update_document(uuid,jsonb,text) to authenticated;
grant execute on function public.delete_document(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('test-images','test-images',false,15728640,array['image/jpeg','image/png','image/webp']);
create policy test_images_select on storage.objects for select to authenticated
  using (bucket_id = 'test-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy test_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'test-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy test_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'test-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
