const axios = require('axios');

async function testLogin() {
  console.log('1. Sending OTP (simulating Driver App Login Screen)');
  try {
    const sendOtpRes = await axios.post('https://api.gomytruck.com/api/v1/auth/send-otp', {
      phone: '9000000000',
      role: 'DRIVER',
      fcmToken: 'test_fake_fcm_token_12345'
    });
    console.log('Send OTP Response:', sendOtpRes.data);
    
    console.log('\n2. Verifying OTP (simulating OTP Screen)');
    const verifyOtpRes = await axios.post('https://api.gomytruck.com/api/v1/auth/verify-otp', {
      phone: '9000000000',
      role: 'DRIVER',
      otp: '123456'
    });
    console.log('Verify OTP Response:', verifyOtpRes.data.success ? 'Success' : 'Failed');
    
  } catch (error) {
    console.error('API Error:', error.response ? error.response.data : error.message);
  }
}

testLogin();
