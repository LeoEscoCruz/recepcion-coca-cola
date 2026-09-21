create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  source text not null,
  delivery_date text,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.products (
  id text primary key,
  name text not null,
  category text not null default 'Otros',
  size_ml integer,
  pack integer,
  image_key text,
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null references public.products(id),
  original_name text not null,
  expected integer not null check (expected > 0),
  received integer not null default 0 check (received >= 0),
  created_at timestamptz not null default now(),
  unique(order_id, product_id)
);

create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists orders_status_created_at_idx on public.orders(status, created_at desc);

alter table public.orders enable row level security;
alter table public.products enable row level security;
alter table public.order_items enable row level security;

-- El frontend nunca consulta Supabase directamente. El backend usa service_role,
-- que puede trabajar con estas tablas aunque RLS esté activado.

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', false)
on conflict (id) do nothing;
