
-- Add individual_first_name column to raw_reservations
ALTER TABLE public.raw_reservations ADD COLUMN IF NOT EXISTS individual_first_name text;
