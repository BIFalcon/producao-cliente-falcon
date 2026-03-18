ALTER TABLE public.raw_reservations ADD COLUMN IF NOT EXISTS number_of_nights numeric DEFAULT 0;
ALTER TABLE public.raw_reservations ADD COLUMN IF NOT EXISTS rate_code text;
ALTER TABLE public.raw_reservations ADD COLUMN IF NOT EXISTS rate_code_description text;
ALTER TABLE public.processed_reservations ADD COLUMN IF NOT EXISTS roomnights numeric DEFAULT 0;