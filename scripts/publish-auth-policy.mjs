// Run with server environment loaded, e.g. node --env-file=.env.local scripts/publish-auth-policy.mjs
const provider = process.env.BACKEND_PROVIDER ?? 'firebase';
const publicProvider = process.env.NEXT_PUBLIC_BACKEND_PROVIDER ?? 'firebase';
const flag = process.env.EMAIL_CONFIRMATION_REQUIRED || 'true';
if (!['firebase', 'supabase'].includes(provider) || publicProvider !== provider || !['true', 'false'].includes(flag)) {
  throw new Error('Provider selections must match and EMAIL_CONFIRMATION_REQUIRED must be true or false.');
}
const policy = { emailConfirmationRequired: flag === 'true' };
if (provider === 'firebase') {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase server credentials are required.');
  const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  await getFirestore(app).doc('security/policy').set(policy);
} else {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url !== process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Matching Supabase URL and server credentials are required.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let completed = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const { data: state, error: readError } = await client.rpc('teamspace_store_epoch');
    if (readError) throw new Error('Could not read database state. Apply the Supabase migration first.');
    const { data, error } = await client.rpc('teamspace_store_commit', { p_epoch: state.epoch,
      p_writes: [{ kind: 'set', path: 'security/policy', data: policy }] });
    if (error) throw new Error('Authentication policy could not be published. Check migration and server permissions.');
    if (!data.conflict) { completed = true; break; }
  }
  if (!completed) throw new Error('Authentication policy encountered concurrent writes. Try again.');
}
console.log(`Authentication read policy published for ${provider}; email confirmation ${policy.emailConfirmationRequired ? 'required' : 'optional'}.`);
