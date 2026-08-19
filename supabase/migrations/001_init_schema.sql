-- Create profiles table (linked to auth.users)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text unique not null,
  name text not null,
  role text not null default 'leader' check (role in ('coordinator', 'leader')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create production_lines table
create table if not exists public.production_lines (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default 'idle' check (status in ('active', 'idle', 'paused')),
  current_op_id uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create production_orders table
create table if not exists public.production_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  product text not null,
  planned_quantity integer not null default 0,
  produced_quantity integer not null default 0,
  priority text not null check (priority in ('Crítica', 'Alta', 'Normal', 'Baixa')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'paused', 'completed')),
  line_id uuid references public.production_lines(id) on delete set null,
  leader_id uuid references public.profiles(id) on delete set null,
  package_availability integer not null default 0,
  sequence integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create production_events table
create table if not exists public.production_events (
  id uuid primary key default gen_random_uuid(),
  op_id uuid references public.production_orders(id) on delete cascade not null,
  line_id uuid references public.production_lines(id) on delete cascade not null,
  leader_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in ('STARTED', 'PAUSED', 'RESUMED', 'FINISHED', 'QUANTITY_REPORTED')),
  quantity integer,
  reason text,
  observation text,
  timestamp timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create weekly_rotations table
create table if not exists public.weekly_rotations (
  id uuid primary key default gen_random_uuid(),
  week_number integer not null,
  year integer not null,
  leader_id uuid references public.profiles(id) on delete cascade not null,
  line_id uuid references public.production_lines(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(week_number, year, leader_id)
);

-- Create pause_reasons table
create table if not exists public.pause_reasons (
  id uuid primary key default gen_random_uuid(),
  reason text not null unique,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Insert default pause reasons
insert into public.pause_reasons (reason, description) values
  ('Falta de insumo', 'Ausência de matéria-prima necessária'),
  ('Falta de embalagem', 'Ausência de embalagem disponível'),
  ('Máquina entupida', 'Entupimento ou obstrução na máquina'),
  ('Manutenção', 'Manutenção preventiva ou corretiva'),
  ('Problema operacional', 'Problema na operação da linha'),
  ('Troca de produto', 'Mudança de produto em produção'),
  ('Limpeza', 'Limpeza e higienização da linha'),
  ('Qualidade', 'Problema de qualidade detectado'),
  ('Aguardando orientação', 'Aguardando orientação do coordenador'),
  ('Outro', 'Outro motivo')
on conflict (reason) do nothing;

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.production_lines enable row level security;
alter table public.production_orders enable row level security;
alter table public.production_events enable row level security;
alter table public.weekly_rotations enable row level security;
alter table public.pause_reasons enable row level security;

-- RLS Policies for profiles
create policy "Users can view their own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Coordinators can view all profiles" on public.profiles
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "Users cannot update their own role" on public.profiles
  for update using (auth.uid() = id) with check (
    auth.uid() = id and role = (select role from public.profiles where id = auth.uid())
  );

-- RLS Policies for production_lines
create policy "Everyone can view production lines" on public.production_lines
  for select using (true);

create policy "Coordinators can insert production lines" on public.production_lines
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "Coordinators can update production lines" on public.production_lines
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

-- RLS Policies for production_orders
create policy "Everyone can view production orders" on public.production_orders
  for select using (true);

create policy "Coordinators can insert production orders" on public.production_orders
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "Coordinators can update all production orders" on public.production_orders
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "Leaders can update their assigned orders" on public.production_orders
  for update using (
    leader_id = auth.uid() or 
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

-- RLS Policies for production_events
create policy "Everyone can view production events" on public.production_events
  for select using (true);

create policy "Coordinators and assigned leader can insert events" on public.production_events
  for insert with check (
    auth.uid() = leader_id or
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

-- RLS Policies for weekly_rotations
create policy "Everyone can view weekly rotations" on public.weekly_rotations
  for select using (true);

create policy "Coordinators can insert rotations" on public.weekly_rotations
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "Coordinators can update rotations" on public.weekly_rotations
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

-- RLS Policies for pause_reasons
create policy "Everyone can view pause reasons" on public.pause_reasons
  for select using (true);

create policy "Coordinators can manage pause reasons" on public.pause_reasons
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

-- Create indexes for performance
create index idx_production_orders_line_id on public.production_orders(line_id);
create index idx_production_orders_leader_id on public.production_orders(leader_id);
create index idx_production_orders_status on public.production_orders(status);
create index idx_production_events_op_id on public.production_events(op_id);
create index idx_production_events_line_id on public.production_events(line_id);
create index idx_production_events_leader_id on public.production_events(leader_id);
create index idx_weekly_rotations_leader_id on public.weekly_rotations(leader_id);
create index idx_weekly_rotations_line_id on public.weekly_rotations(line_id);
create index idx_weekly_rotations_week_year on public.weekly_rotations(week_number, year);
