// YardLine Booking System - Database Helper Functions
// This file contains all database operations for the booking system

import { SupabaseClient } from '@supabase/supabase-js';

// Database types matching the migration schema
export interface DBService {
  service_id: string;
  provider_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DBBooking {
  id: string;
  customer_id: string;
  provider_id: string;
  service_id: string | null;
  date: string; // YYYY-MM-DD
  time_start: string; // HH:MM:SS or HH:MM
  time_end: string; // HH:MM:SS or HH:MM
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'expired';
  payment_status: 'none' | 'authorized' | 'captured' | 'canceled' | 'failed' | 'expired';
  payment_intent_id: string | null;
  amount_total: number | null;
  service_price_cents: number | null;
  platform_fee_cents: number | null;
  decline_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Service Operations
// ============================================================================

export async function createService(
  supabase: SupabaseClient,
  providerId: string,
  name: string,
  description: string,
  priceCents: number,
  duration: number
): Promise<DBService> {
  const { data, error } = await supabase
    .from('services')
    .insert({
      provider_id: providerId,
      name,
      description,
      price_cents: priceCents,
      duration,
      active: true
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getService(
  supabase: SupabaseClient,
  serviceId: string
): Promise<DBService | null> {
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('service_id', serviceId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  return data;
}

export async function listServices(
  supabase: SupabaseClient,
  providerId?: string
): Promise<DBService[]> {
  let query = supabase.from('services').select('*');
  
  if (providerId) {
    query = query.eq('provider_id', providerId);
  }
  
  query = query.eq('active', true);
  
  const { data, error } = await query;
  
  if (error) throw error;
  return data || [];
}

// ============================================================================
// Booking Operations
// ============================================================================

export async function createBooking(
  supabase: SupabaseClient,
  bookingData: {
    customerId: string;
    providerId: string;
    serviceId: string | null;
    date: string; // YYYY-MM-DD
    timeStart: string; // HH:MM:SS or HH:MM
    timeEnd: string; // HH:MM:SS or HH:MM
    paymentIntentId: string | null;
    amountTotal: number | null;
    servicePriceCents: number | null;
    platformFeeCents: number | null;
  }
): Promise<DBBooking> {
  // Validate time_end > time_start
  const startTime = bookingData.timeStart;
  const endTime = bookingData.timeEnd;
  if (startTime >= endTime) {
    throw new Error('time_end must be greater than time_start');
  }

  const insertData = {
    customer_id: bookingData.customerId,
    provider_id: bookingData.providerId,
    service_id: bookingData.serviceId,
    date: bookingData.date,
    time_start: bookingData.timeStart,
    time_end: bookingData.timeEnd,
    status: 'pending' as const,
    payment_status: (bookingData.paymentIntentId ? 'authorized' : 'none') as const,
    payment_intent_id: bookingData.paymentIntentId,
    amount_total: bookingData.amountTotal,
    service_price_cents: bookingData.servicePriceCents,
    platform_fee_cents: bookingData.platformFeeCents
  };

  const { data, error } = await supabase
    .from('bookings')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    // Handle exclusion constraint violation
    if (error.code === '23P01' || error.message?.includes('no_double_booking')) {
      const conflictError = new Error('Time slot already booked') as any;
      conflictError.code = 'BOOKING_CONFLICT';
      conflictError.statusCode = 409;
      throw conflictError;
    }
    throw error;
  }
  return data;
}

export async function getBooking(
  supabase: SupabaseClient,
  bookingId: string
): Promise<DBBooking | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  return data;
}

export async function getBookingByPaymentIntent(
  supabase: SupabaseClient,
  paymentIntentId: string
): Promise<DBBooking | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('payment_intent_id', paymentIntentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  return data;
}

export async function listBookings(
  supabase: SupabaseClient,
  filters: {
    customerId?: string;
    providerId?: string;
    status?: string;
  }
): Promise<DBBooking[]> {
  let query = supabase.from('bookings').select('*');
  
  if (filters.customerId) {
    query = query.eq('customer_id', filters.customerId);
  }
  
  if (filters.providerId) {
    query = query.eq('provider_id', filters.providerId);
  }
  
  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  
  query = query.order('created_at', { ascending: false });
  
  const { data, error } = await query;
  
  if (error) throw error;
  return data || [];
}

export async function updateBookingStatus(
  supabase: SupabaseClient,
  bookingId: string,
  status: DBBooking['status'],
  paymentStatus: DBBooking['payment_status'],
  declineReason?: string
): Promise<DBBooking> {
  const updateData: {
    status: DBBooking['status'];
    payment_status: DBBooking['payment_status'];
    updated_at: string;
    decline_reason?: string;
  } = {
    status,
    payment_status: paymentStatus,
    updated_at: new Date().toISOString()
  };
  
  if (declineReason) {
    updateData.decline_reason = declineReason;
  }
  
  const { data, error } = await supabase
    .from('bookings')
    .update(updateData)
    .eq('id', bookingId)
    .select()
    .single();

  if (error) {
    // Handle exclusion constraint violation on update
    if (error.code === '23P01' || error.message?.includes('no_double_booking')) {
      const conflictError = new Error('Time slot already booked') as any;
      conflictError.code = 'BOOKING_CONFLICT';
      conflictError.statusCode = 409;
      throw conflictError;
    }
    throw error;
  }
  return data;
}

export async function updateBookingPaymentStatus(
  supabase: SupabaseClient,
  bookingId: string,
  paymentStatus: DBBooking['payment_status']
): Promise<DBBooking> {
  const { data, error } = await supabase
    .from('bookings')
    .update({
      payment_status: paymentStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================================================
// Double Booking Check using SQL RPC function
// ============================================================================

export async function checkBookingConflict(
  supabase: SupabaseClient,
  providerId: string,
  date: string, // YYYY-MM-DD
  timeStart: string, // HH:MM:SS or HH:MM
  timeEnd: string, // HH:MM:SS or HH:MM
  excludeBookingId?: string
): Promise<boolean> {
  // Call the SQL function check_booking_conflict
  const { data, error } = await supabase.rpc('check_booking_conflict', {
    p_provider_id: providerId,
    p_date: date,
    p_time_start: timeStart,
    p_time_end: timeEnd,
    p_exclude_booking_id: excludeBookingId || null
  });
  
  if (error) throw error;
  return data === true;
}

// ============================================================================
// Transaction-based Accept with Conflict Check
// ============================================================================

export async function acceptBookingTransaction(
  supabase: SupabaseClient,
  bookingId: string
): Promise<{ success: boolean; booking?: DBBooking; conflict?: boolean; error?: string }> {
  try {
    // Fetch current booking state
    const booking = await getBooking(supabase, bookingId);
    
    if (!booking) {
      return { success: false, error: 'Booking not found' };
    }
    
    // Check if already confirmed (idempotency)
    if (booking.status !== 'pending') {
      return { success: false, error: `Booking is ${booking.status}, not pending` };
    }
    
    // Check for conflicts using SQL function
    const hasConflict = await checkBookingConflict(
      supabase,
      booking.provider_id,
      booking.date,
      booking.time_start,
      booking.time_end,
      bookingId
    );
    
    if (hasConflict) {
      return { success: false, conflict: true, error: 'Time slot conflict detected' };
    }
    
    // Update to confirmed - database exclusion constraint will prevent race conditions
    try {
      const updatedBooking = await updateBookingStatus(
        supabase,
        bookingId,
        'confirmed',
        'captured'
      );
      return { success: true, booking: updatedBooking };
    } catch (error: any) {
      // Check if it's an exclusion constraint violation
      if (error.code === 'BOOKING_CONFLICT' || error.code === '23P01') {
        return { success: false, conflict: true, error: 'Booking conflict detected by database constraint' };
      }
      throw error;
    }
  } catch (error: any) {
    console.error('Error in acceptBookingTransaction:', error);
    return { success: false, error: error.message };
  }
}
