# เชื่อม Supabase กับ BBK AUCTION

ไฟล์นี้ไม่ต้องใส่ Secret key และไม่ควรส่ง Secret key ผ่านแชต

## 1. สร้าง `.env.local`

คัดลอก `.env.example` เป็น `.env.local` แล้วกรอกเฉพาะ:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
NEXT_PUBLIC_PAYMENTS_ENABLED=false
```

Project URL และ Publishable key ดูได้จากปุ่ม **Connect** ใน Supabase Dashboard

## 2. รัน migration

เปิด Supabase SQL Editor แล้วรันไฟล์ใน `supabase/migrations` ตามลำดับชื่อไฟล์ ห้ามข้ามไฟล์

## 3. ตั้งค่า Auth

- Site URL สำหรับเครื่อง: `http://localhost:3000`
- Redirect URL: `http://localhost:3000/auth/callback`
- เมื่อขึ้น Vercel ให้เพิ่มโดเมนจริงและ `/auth/callback` ของโดเมนนั้น
- เปิด Email confirmation สำหรับบัญชีผู้ประมูลจริง

## 4. สร้างผู้ใช้คนแรกและมอบบทบาท

1. สมัครผ่าน `/auth/sign-in`
2. ยืนยันอีเมล
3. ดู UUID ของผู้ใช้จาก Authentication → Users
4. รันคำสั่งด้านล่างโดยแทน UUID จริง

```sql
insert into public.role_assignments (user_id, role_name, assigned_by)
values ('USER_UUID_HERE', 'admin', 'USER_UUID_HERE')
on conflict do nothing;
```

การให้สิทธิ์แอดมินเป็นการเปลี่ยนสิทธิ์สำคัญ ต้องตรวจ UUID และบัญชีให้ถูกต้องก่อนรัน

## 5. ตรวจผล

```powershell
pnpm dev
```

- สมัคร/เข้าสู่ระบบได้
- ผู้ไม่มี role เข้า `/admin` แล้วถูกส่งไปหน้า 403
- แอดมินเข้าหน้า `/admin` ได้
- หน้า `/` แสดงคำว่า `CONNECTED`
- เปิดรายการจริงแล้ววาง bid ผ่าน RPC ได้

ระบบชำระเงินยังต้องคง `NEXT_PUBLIC_PAYMENTS_ENABLED=false`
