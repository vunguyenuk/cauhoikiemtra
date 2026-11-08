import { getSupabase, readableError } from './supabase.js';
import { partitionQuestions } from '../features/uploads/deduplicate.js';
import { validateImage } from '../features/ocr/recognizer.js';

const BUCKET = 'test-images';
const PAGE_SIZE = 100;

function mapDocument(row, imageUrl) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    filename: row.filename,
    rawText: row.raw_text,
    imagePath: row.image_path,
    imageUrl,
    createdAt: row.created_at,
    questions: (row.questions || [])
      .sort((first, second) => first.position - second.position)
      .map((item) => ({ ...item.payload, id: item.id })),
  };
}

async function withImage(row) {
  const { data, error } = await getSupabase()
    .storage.from(BUCKET)
    .createSignedUrl(row.image_path, 7200);
  if (error) throw readableError(error);
  return mapDocument(row, data.signedUrl);
}

export async function listDocuments() {
  const client = getSupabase();
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('documents')
      .select('id,owner_id,filename,raw_text,image_path,created_at,questions(id,payload,position)')
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw readableError(error);
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return Promise.all(rows.map(withImage));
}

export async function getDocument(id) {
  const { data, error } = await getSupabase()
    .from('documents')
    .select('id,owner_id,filename,raw_text,image_path,created_at,questions(id,payload,position)')
    .eq('id', id)
    .single();
  if (error) throw readableError(error);
  return withImage(data);
}

/** Images go directly to Storage, so the 15 MB limit does not pass through a Vercel Function. */
export async function saveDocument(file, draft) {
  validateImage(file);
  const client = getSupabase();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user) throw new Error('Đăng nhập để thêm ảnh và lưu dữ liệu.');
  const id = crypto.randomUUID();
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  const imagePath = `${user.id}/${id}.${extension}`;
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const { error: uploadError } = await client.storage.from(BUCKET).upload(imagePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw readableError(uploadError);

  const { data, error } = await client.rpc('import_document', {
    p_id: id,
    p_filename: file.name.slice(0, 240),
    p_image_path: imagePath,
    p_mime: file.type,
    p_digest: digest,
    p_raw_text: draft.rawText,
    p_questions: draft.questions,
  });
  if (error) {
    // A request can lose its response after committing. Check before removing its image.
    const lookup = await client.from('documents').select('id').eq('id', id).maybeSingle();
    if (lookup.error) throw readableError(error);
    if (lookup.data) return { document: await getDocument(id), duplicates: [] };
    const cleanup = await client.storage.from(BUCKET).remove([imagePath]);
    if (cleanup.error) console.error('Could not remove incomplete upload:', cleanup.error.message);
    throw readableError(error);
  }
  if (!data.documentId) {
    const cleanup = await client.storage.from(BUCKET).remove([imagePath]);
    if (cleanup.error) console.error('Could not remove redundant image:', cleanup.error.message);
  }
  return {
    document: data.documentId ? await getDocument(data.documentId) : null,
    duplicates: (data.duplicates || []).map((item) => {
      const compared = partitionQuestions([item.incoming], [item.existing]);
      return compared.duplicates[0] || { ...item, conflictingAnswer: false };
    }),
  };
}

export async function updateDocument(id, questions, rawText) {
  const { error } = await getSupabase().rpc('update_document', {
    p_id: id,
    p_questions: questions,
    p_raw_text: rawText,
  });
  if (error) throw readableError(error);
  return getDocument(id);
}

export async function deleteDocument(id) {
  const client = getSupabase();
  const { data: row, error } = await client
    .from('documents')
    .select('image_path')
    .eq('id', id)
    .single();
  if (error) throw readableError(error);
  // Keep the row visible and retryable if deleting the file fails.
  const { error: storageError } = await client.storage.from(BUCKET).remove([row.image_path]);
  if (storageError) throw readableError(storageError);
  const { error: deleteError } = await client.rpc('delete_document', { p_id: id });
  if (deleteError) throw readableError(deleteError);
}
