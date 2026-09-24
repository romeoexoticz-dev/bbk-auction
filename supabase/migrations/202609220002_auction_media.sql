-- Private-by-default auction media. Object path format:
-- <seller_uuid>/<auction_uuid>/<random_filename>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'auction-media',
  'auction-media',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.auction_media (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  bucket_id text not null default 'auction-media' check (bucket_id = 'auction-media'),
  object_path text not null unique,
  media_kind text not null default 'gallery' check (media_kind in ('cover', 'gallery', 'defect', 'evidence')),
  position integer not null default 0 check (position >= 0),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  unique (auction_id, position)
);

create index auction_media_auction_idx on public.auction_media (auction_id, position);
alter table public.auction_media enable row level security;

create policy "published auction media metadata is readable"
on public.auction_media for select to anon, authenticated
using (
  exists (
    select 1 from public.auctions a
    where a.id = auction_id and a.status in ('scheduled', 'live', 'ended', 'settled')
  )
);

create policy "sellers read own auction media metadata"
on public.auction_media for select to authenticated
using (owner_id = auth.uid() or public.has_role('admin'));

create policy "sellers add media metadata to editable auctions"
on public.auction_media for insert to authenticated
with check (
  owner_id = auth.uid()
  and public.has_role('seller')
  and exists (
    select 1 from public.auctions a
    where a.id = auction_id
      and a.seller_id = auth.uid()
      and a.status in ('draft', 'rejected')
  )
);

create policy "sellers update own editable media metadata"
on public.auction_media for update to authenticated
using (
  owner_id = auth.uid()
  and exists (
    select 1 from public.auctions a
    where a.id = auction_id and a.seller_id = auth.uid() and a.status in ('draft', 'rejected')
  )
)
with check (owner_id = auth.uid());

create policy "sellers delete own editable media metadata"
on public.auction_media for delete to authenticated
using (
  owner_id = auth.uid()
  and exists (
    select 1 from public.auctions a
    where a.id = auction_id and a.seller_id = auth.uid() and a.status in ('draft', 'rejected')
  )
);

create policy "admins manage auction media metadata"
on public.auction_media for all to authenticated
using (public.has_role('admin')) with check (public.has_role('admin'));

grant select on public.auction_media to anon, authenticated;
grant insert, update, delete on public.auction_media to authenticated;

create policy "published auction media objects are readable"
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'auction-media'
  and exists (
    select 1
    from public.auction_media am
    join public.auctions a on a.id = am.auction_id
    where am.bucket_id = storage.objects.bucket_id
      and am.object_path = storage.objects.name
      and a.status in ('scheduled', 'live', 'ended', 'settled')
  )
);

create policy "sellers read own auction media objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'auction-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_role('admin')
  )
);

create policy "approved sellers upload auction media objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'auction-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.has_role('seller')
  and exists (
    select 1
    from public.auctions a
    join public.seller_profiles sp on sp.user_id = a.seller_id
    where a.id::text = (storage.foldername(name))[2]
      and a.seller_id = auth.uid()
      and a.status in ('draft', 'rejected')
      and sp.status = 'approved'
  )
);

create policy "sellers update own editable auction media objects"
on storage.objects for update to authenticated
using (
  bucket_id = 'auction-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.auctions a
    where a.id::text = (storage.foldername(name))[2]
      and a.seller_id = auth.uid()
      and a.status in ('draft', 'rejected')
  )
)
with check (
  bucket_id = 'auction-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "sellers delete own editable auction media objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'auction-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.auctions a
    where a.id::text = (storage.foldername(name))[2]
      and a.seller_id = auth.uid()
      and a.status in ('draft', 'rejected')
  )
);

create policy "admins manage auction media objects"
on storage.objects for all to authenticated
using (bucket_id = 'auction-media' and public.has_role('admin'))
with check (bucket_id = 'auction-media' and public.has_role('admin'));
