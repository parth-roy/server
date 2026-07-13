const axios = require('axios');

async function triggerBooking() {
  try {
    console.log('1. Logging in as Customer...');
    const verifyOtpRes = await axios.post('https://api.gomytruck.com/api/v1/auth/verify-otp', {
      phone: '9852364101',
      role: 'CUSTOMER',
      otp: '123456'
    });
    const token = verifyOtpRes.data.data.accessToken;
    console.log('Customer logged in successfully!');

    // The driver is at 22.762473, 88.366595 (Barrackpore, India)
    // We will create a booking exactly there so the driver gets the dispatch alert.
    const bookingPayload = {
      vehicleType: "TRUCK_14FT",
      pickupAddress: "Test Pickup Location",
      pickupLat: 22.762473,
      pickupLng: 88.366595,
      stops: [
        {
          sequence: 1,
          address: "Test Dropoff Location",
          latitude: 22.770000,
          longitude: 88.370000,
          receiverName: "John Doe",
          receiverPhone: "9876543210"
        }
      ],
      distanceKm: 5,
      estimatedMinutes: 15,
      goodsType: "FMCG",
      paymentMode: "CASH"
    };

    console.log('\n2. Creating Booking...');
    const createRes = await axios.post('https://api.gomytruck.com/api/v1/bookings', bookingPayload, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const bookingId = createRes.data.data.id;
    console.log(`Booking created! ID: ${bookingId}`);

    console.log('\n3. Confirming Booking (This triggers the DISPATCH to your Driver App!)...');
    await axios.patch(`https://api.gomytruck.com/api/v1/bookings/${bookingId}/confirm`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Booking confirmed! Dispatch notification has been sent to the driver!');

  } catch (error) {
    console.error('API Error:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
  }
}

triggerBooking();
