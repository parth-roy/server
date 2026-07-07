import { PrismaClient, VehicleType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding mock jobs for Job Radar...');

  // Ensure a test user and fleet exist so we can create bookings
  let user = await prisma.user.findFirst({ where: { role: 'CUSTOMER' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: uuidv4(),
        phone: '+919999999999',
        role: 'CUSTOMER',
        isPhoneVerified: true,
      },
    });
  }

  const locations = [
    { name: 'Salt Lake', lat: 22.587, lng: 88.423 },
    { name: 'Salt Lake', lat: 22.585, lng: 88.419 },
    { name: 'Salt Lake', lat: 22.582, lng: 88.420 },
    { name: 'Salt Lake', lat: 22.588, lng: 88.415 },
    { name: 'Salt Lake', lat: 22.580, lng: 88.425 },

    { name: 'Howrah', lat: 22.580, lng: 88.330 },
    { name: 'Howrah', lat: 22.578, lng: 88.328 },
    { name: 'Howrah', lat: 22.582, lng: 88.325 },
    { name: 'Howrah', lat: 22.579, lng: 88.335 },

    { name: 'Park Circus', lat: 22.544, lng: 88.368 },
    { name: 'Park Circus', lat: 22.545, lng: 88.365 },
    { name: 'Park Circus', lat: 22.542, lng: 88.370 },

    { name: 'New Town', lat: 22.572, lng: 88.477 },
    { name: 'New Town', lat: 22.575, lng: 88.480 },
  ];

  const types: ('LOADING' | 'UNLOADING' | 'BOTH')[] = ['LOADING', 'UNLOADING', 'BOTH'];

  let count = 0;
  for (const loc of locations) {
    count++;
    const type = types[Math.floor(Math.random() * types.length)];
    const payout = Math.floor(Math.random() * (1200 - 300 + 1) + 300); // 300 to 1200
    const workers = Math.floor(Math.random() * 3) + 1; // 1 to 3

    await prisma.booking.create({
      data: {
        bookingNumber: `JOB-RADAR-${count}-${Date.now().toString().slice(-4)}`,
        customerId: user.id,
        vehicleType: 'TATA_ACE',
        pickupLat: loc.lat + (Math.random() * 0.005 - 0.0025), // Slight jitter
        pickupLng: loc.lng + (Math.random() * 0.005 - 0.0025),
        pickupAddress: `${loc.name}, Kolkata, WB`,
        status: 'CONFIRMED',
        laborRequired: true,
        laborType: type,
        laborersCount: workers,
        laborCharge: payout,
        totalFare: payout + 500, // Dummy
        stops: {
          create: [{
            sequence: 1,
            latitude: loc.lat + 0.05,
            longitude: loc.lng + 0.05,
            address: `${loc.name} Destination`,
          }]
        }
      },
    });
  }

  console.log(`Seeded ${locations.length} active jobs in Salt Lake, Howrah, Park Circus, and New Town!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
