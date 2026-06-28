import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function exportUlipLogs() {
  console.log('Fetching successful ULIP verification logs from the database...');

  // Get the most recent successful SARATHI and VAHAN logs
  const logs = await prisma.verificationLog.findMany({
    where: { status: 'VERIFIED' },
    orderBy: { calledAt: 'desc' },
    take: 20
  });

  const sarathiLog = logs.find(l => l.apiCalled === 'SARATHI/01' || l.apiCalled === 'AUTHAPI/03');
  const vahanLog = logs.find(l => l.apiCalled === 'VAHAN/01' || l.apiCalled === 'AUTHAPI/02');
  const fastagLog = logs.find(l => l.apiCalled === 'FASTAG/01');
  const echallanLog = logs.find(l => l.apiCalled === 'ECHALLAN/01');
  const digilockerLog = logs.find(l => l.apiCalled === 'DIGILOCKER/01');

  const exportData = {
    testCases: [
      {
        apiName: "SARATHI/01 (AUTHAPI/03)",
        status: "SUCCESS",
        requestPayload: sarathiLog?.requestBody || "No successful log found",
        responsePayload: sarathiLog?.response || "No successful log found"
      },
      {
        apiName: "VAHAN/01 (AUTHAPI/02)",
        status: "SUCCESS",
        requestPayload: vahanLog?.requestBody || "No successful log found",
        responsePayload: vahanLog?.response || "No successful log found"
      },
      {
        apiName: "FASTAG/01",
        status: "SUCCESS",
        requestPayload: fastagLog?.requestBody || "No successful log found",
        responsePayload: fastagLog?.response || "No successful log found"
      },
      {
        apiName: "ECHALLAN/01",
        status: "SUCCESS",
        requestPayload: echallanLog?.requestBody || "No successful log found",
        responsePayload: echallanLog?.response || "No successful log found"
      },
      {
        apiName: "DIGILOCKER/01",
        status: "SUCCESS",
        requestPayload: digilockerLog?.requestBody || "No successful log found",
        responsePayload: digilockerLog?.response || "No successful log found"
      }
    ]
  };

  fs.writeFileSync('ulip-test-cases.json', JSON.stringify(exportData, null, 2));
  
  console.log('\n✅ Successfully exported test cases to: ulip-test-cases.json');
  console.log('You can now download this file and upload it to the ULIP portal!');
}

exportUlipLogs()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
