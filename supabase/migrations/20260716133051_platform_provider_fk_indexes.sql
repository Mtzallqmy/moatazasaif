create index if not exists platform_provider_usage_provider_idx
  on public.platform_provider_usage(provider_id);

create index if not exists platform_provider_reservations_provider_idx
  on public.platform_provider_reservations(provider_id);
