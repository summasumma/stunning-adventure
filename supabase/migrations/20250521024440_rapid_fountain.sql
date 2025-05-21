/*
  # Add email column to patients table

  1. Changes
    - Add `email` column to `patients` table if it doesn't exist
    
  2. Notes
    - Uses safe migration pattern with IF NOT EXISTS check
    - Maintains existing data
*/

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'patients' 
    AND column_name = 'email'
  ) THEN 
    ALTER TABLE patients ADD COLUMN email TEXT;
  END IF;
END $$;