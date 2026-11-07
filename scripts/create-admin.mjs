import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Client } = pg;
const phone = process.env.ADMIN_PHONE;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME;
if (!phone || !password || !name) throw new Error('Set ADMIN_PHONE, ADMIN_PASSWORD, and ADMIN_NAME in the shell.');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL before creating an administrator.');
const digits = phone.replace(/\D/g,'');
const normalizedPhone = digits.length === 9 && /^[17]/.test(digits) ? `+254${digits}`
  : digits.length === 10 && /^0[17]/.test(digits) ? `+254${digits.slice(1)}`
  : digits.length === 12 && /^254[17]/.test(digits) ? `+${digits}` : null;
if (!normalizedPhone) throw new Error('ADMIN_PHONE must be a Kenyan mobile number.');
if (password.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
const passwordHash = await bcrypt.hash(password, 12);
const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  await client.query(`INSERT INTO public.users(phone,password_hash,full_name,role,status)
    VALUES ($1,$2,$3,'admin','approved')
    ON CONFLICT (phone) DO UPDATE SET password_hash=EXCLUDED.password_hash,
      full_name=EXCLUDED.full_name,role='admin',status='approved',updated_at=now()`,
  [normalizedPhone,passwordHash,name.trim()]);
  console.info('Administrator account created or promoted.');
} finally { await client.end(); }
