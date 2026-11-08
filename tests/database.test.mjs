import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { questionKey } from '../src/features/uploads/deduplicate.js';
import { questions as builtin } from '../src/data/questions.js';

const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
const example = {
  question: 'Một câu hỏi hoàn toàn mới?',
  options: ['Một', 'Hai'],
  correct: 1,
  isDocument: false,
};

test('Postgres migrations, deduplication, editing, validation and owner isolation', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  // Only Supabase platform schemas are represented here; app SQL is executed unchanged.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as
      $$select string_to_array($1, '/')$$;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant select, insert, delete on storage.objects to authenticated;
  `);
  await db.exec(
    readFileSync(new URL('../supabase/migrations/0001_schema.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/0002_builtin_questions.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.query('insert into auth.users(id) values($1),($2)', [owner, stranger]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  await db.exec('set role authenticated');

  async function importImage(
    questions,
    { id = randomUUID(), digest = id.replaceAll('-', '').padEnd(64, '0') } = {},
  ) {
    const path = `${owner}/${id}.jpg`;
    await db.query("insert into storage.objects(bucket_id,name) values('test-images',$1)", [path]);
    const result = await db.query(
      'select public.import_document($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
      [
        id,
        'image.jpg',
        path,
        'image/jpeg',
        digest,
        'Recognized text from image',
        JSON.stringify(questions),
      ],
    );
    return result.rows[0].result;
  }

  await t.test('SQL and JavaScript agree on Vietnamese identity normalization', async () => {
    for (const question of [
      ...builtin,
      { ...example, question: 'ETC-OTC/ Câu 12:   ĐƯỜNG mũi?' },
      { ...example, isDocument: true, rawText: 'Đây là chữ đầy đủ. Nội dung mới!' },
    ]) {
      const result = await db.query('select public.question_key($1::jsonb) as key', [
        JSON.stringify(question),
      ]);
      assert.equal(result.rows[0].key, questionKey(question));
    }
  });
  await t.test('builtin duplicates create no document or question', async () => {
    const result = await importImage([builtin[0]]);
    assert.equal(result.documentId, null);
    assert.equal(result.duplicates[0].existing.options[1], 'Mometason furoat');
    assert.equal(
      (await db.query('select count(*)::int as count from public.documents')).rows[0].count,
      0,
    );
  });
  let firstDocument;
  await t.test('mixed image saves only new questions, deduplicates within one batch', async () => {
    const result = await importImage([builtin[0], example, { ...example }]);
    firstDocument = result.documentId;
    assert.ok(firstDocument);
    assert.equal(result.duplicates.length, 2);
    assert.equal(
      (await db.query('select count(*)::int as count from public.questions')).rows[0].count,
      1,
    );
  });
  await t.test(
    'same content from another image returns existing answer without saving',
    async () => {
      const result = await importImage([{ ...example, correct: 0 }]);
      assert.equal(result.documentId, null);
      assert.equal(result.duplicates[0].existing.correct, 1);
      assert.equal(
        (await db.query('select count(*)::int as count from public.documents')).rows[0].count,
        1,
      );
    },
  );
  await t.test('direct writes cannot bypass the RPC', async () => {
    await assert.rejects(db.query('delete from public.documents'), /permission denied/);
    await assert.rejects(
      db.query("insert into public.builtin_questions(id,payload) values(999,'{}')"),
      /permission denied/,
    );
  });
  await t.test('editing to duplicate content is rejected, original survives', async () => {
    const {
      rows: [row],
    } = await db.query('select id,payload from public.questions limit 1');
    await assert.rejects(
      db.query('select public.update_document($1,$2::jsonb,$3)', [
        firstDocument,
        JSON.stringify([{ ...builtin[0], id: row.id }]),
        'Updated full text',
      ]),
      /đã có/,
    );
    assert.equal(
      (await db.query('select payload from public.questions where id=$1', [row.id])).rows[0].payload
        .question,
      example.question,
    );
    await db.query('select public.update_document($1,$2::jsonb,$3)', [
      firstDocument,
      JSON.stringify([{ ...row.payload, id: row.id, correct: 0 }]),
      'Updated full text',
    ]);
    assert.equal(
      (await db.query('select payload from public.questions where id=$1', [row.id])).rows[0].payload
        .correct,
      0,
    );
  });
  await t.test('malformed questions roll back the entire import', async () => {
    await assert.rejects(importImage([{ ...example, options: 'bad' }]), /không hợp lệ/);
    assert.equal(
      (await db.query('select count(*)::int as count from public.documents')).rows[0].count,
      1,
    );
    await assert.rejects(importImage([{ ...example, correct: 10 }]), /không hợp lệ/);
  });
  await t.test('another user cannot read, edit, delete or access image objects', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [stranger]);
    assert.equal((await db.query('select * from public.documents')).rows.length, 0);
    assert.equal((await db.query('select * from public.questions')).rows.length, 0);
    assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
    await assert.rejects(
      db.query('select public.delete_document($1)', [firstDocument]),
      /Không tìm thấy/,
    );
    await assert.rejects(
      db.query('select public.update_document($1,$2::jsonb,$3)', [firstDocument, '[]', 'Bad text']),
      /Không tìm thấy/,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  });
  await t.test('owner can delete the document and associated question rows', async () => {
    await db.query('select public.delete_document($1)', [firstDocument]);
    assert.equal((await db.query('select * from public.questions')).rows.length, 0);
    assert.equal((await db.query('select * from public.documents')).rows.length, 0);
  });
  await t.test('anonymous callers cannot execute import RPC', async () => {
    await db.exec('reset role; set role anon');
    await assert.rejects(
      db.query('select public.import_document($1,$2,$3,$4,$5,$6,$7::jsonb)', [
        randomUUID(),
        'file.jpg',
        'bad',
        'image/jpeg',
        'a'.repeat(64),
        'raw text',
        '[]',
      ]),
      /permission denied/,
    );
  });
});
