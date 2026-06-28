import axios from 'axios';

// Using the STAGING credentials
const ULIP_USERNAME = "znpy_parther_usr";
const ULIP_PASSWORD = "@#123123gG";
// Hitting the STAGING endpoint
const BASE_URL = "https://www.ulipstaging.dpiit.gov.in/ulip/v1.0.0";

async function runTests() {
  try {
    console.log("1. Authenticating with ULIP STAGING Server...");
    const loginRes = await axios.post(`${BASE_URL}/user/login`, {
      username: ULIP_USERNAME,
      password: ULIP_PASSWORD
    });
    
    const token = loginRes.data?.response?.id;
    if (!token) throw new Error("Failed to get token: " + JSON.stringify(loginRes.data));
    console.log("Token received successfully!\n");

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    const tests = [
      { name: "VAHAN/01", endpoint: "/VAHAN/01", payload: { vehiclenumber: "UP32KH0320" } },
      { name: "VAHAN/02", endpoint: "/VAHAN/02", payload: { chasisnumber: "MAT447230H3F13971" } },
      { name: "VAHAN/03", endpoint: "/VAHAN/03", payload: { enginenumber: "GC74B44246" } },
      { name: "FASTAG/01", endpoint: "/FASTAG/01", payload: { vehiclenumber: "CG07BC9186" } },
      { name: "FASTAG/02", endpoint: "/FASTAG/02", payload: { vehiclenumber: "", tagid: "34161FA8203286140F4064E0" } }
    ];

    for (const test of tests) {
      console.log(`=== Running ${test.name} ===`);
      console.log(`Payload:`, test.payload);
      try {
        const res = await axios.post(`${BASE_URL}${test.endpoint}`, test.payload, { headers, timeout: 30000 });
        console.log(`Status: ${res.status}`);
        console.log(`Response:`, JSON.stringify(res.data).substring(0, 300) + (JSON.stringify(res.data).length > 300 ? "..." : ""));
        if (res.data.error === "true" || res.data.error === true) {
           console.log("ERROR returned by ULIP:", res.data.message);
        }
      } catch (err: any) {
        console.log(`Error running ${test.name}:`, err.message);
        if (err.response) {
          console.log(`Response Data:`, err.response.data);
        }
      }
      console.log("\n");
    }

  } catch (error: any) {
    console.error("Critical Error:", error.message);
  }
}

runTests();
