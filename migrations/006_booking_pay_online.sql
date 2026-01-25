-- YardLine Booking Pay Online Flow Migration
-- Adds checkout_created status for unpaid bookings before payment

ALTER TABLE bookings
DROP CONSTRAINT IF EXISTS bookings_status_check,
ADD CONSTRAINT bookings_status_check CHECK (
  status IN ('checkout_created', 'pending', 'accepted', 'confirmed', 'declined', 'cancelled', 'expired')
);

COMMENT ON COLUMN bookings.status IS 'Booking status: checkout_created (unpaid), pending (paid/requested), accepted (provider approved), confirmed (legacy), declined, cancelled, expired';
