const axios = require('axios');

async function checkLastInvoice() {
  try {
    // We'll directly query the DB to get the last completed booking's invoice details as the backend would calculate them
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    const booking = await prisma.booking.findFirst({
      where: { status: 'COMPLETED' },
      orderBy: { updatedAt: 'desc' }
    });

    if (!booking) {
      console.log('No completed bookings found.');
      return;
    }

    console.log('=== LATEST COMPLETED BOOKING ===');
    console.log('Booking ID:', booking.id);
    console.log('totalFare:', booking.totalFare, typeof booking.totalFare);
    console.log('baseFare:', booking.baseFare, typeof booking.baseFare);
    console.log('grandTotal:', booking.grandTotal, typeof booking.grandTotal);
    
    // Simulate backend invoice calculation
    const loadingCharge = booking.loadingCharge ?? 0;
    const insuranceCharge = booking.insuranceAmount ?? 0;
    const freightBase = (booking.totalFare || 0) - loadingCharge - insuranceCharge;
    const freightGst = parseFloat((freightBase * 0.05).toFixed(2));
    const loadingGst = parseFloat((loadingCharge * 0.18).toFixed(2));
    const insuranceGst = parseFloat((insuranceCharge * 0.18).toFixed(2));
    const totalGst = parseFloat((freightGst + loadingGst + insuranceGst).toFixed(2));
    const waitingCharge = booking.waitingCharge ?? 0;
    const tollCharge = booking.tollCharge ?? 0;
    
    const calculatedGrandTotal = parseFloat(((booking.totalFare || 0) + totalGst + waitingCharge + tollCharge).toFixed(2));
    
    console.log('Calculated Grand Total:', calculatedGrandTotal);
    console.log('================================');

    await prisma.$disconnect();
  } catch (err) {
    console.error(err);
  }
}
checkLastInvoice();
