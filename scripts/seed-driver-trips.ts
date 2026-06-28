import { PrismaClient, BookingStatus } from '@prisma/client';
import { randomInt } from 'crypto';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding driver trips...');
    const customerId = 'c0000000-0000-0000-0000-000000000000'; // Dummy customer
    
    // Check if dummy customer exists
    let customer = await prisma.user.findUnique({ where: { id: customerId } });
    if (!customer) {
        customer = await prisma.user.create({
            data: {
                id: customerId,
                phone: '+919999999999',
                role: 'CUSTOMER',
                profileComplete: true,
                name: 'Dummy Customer',
            }
        });
    }

    const driverId = '02da223d-f7e7-434d-a9f5-df98b6ce11d4';

    // Create 3 completed trips for today
    for (let i = 0; i < 3; i++) {
        const fare = randomInt(500, 2500);
        await prisma.booking.create({
            data: {
                bookingNumber: `BK20260520${randomInt(10000, 99999)}`,
                customerId: customer.id,
                driverId: driverId,
                status: BookingStatus.COMPLETED,
                vehicleType: 'TATA_ACE',
                pickupLat: 19.0760,
                pickupLng: 72.8777,
                pickupAddress: 'Mumbai Central, Mumbai',
                totalFare: fare,
                actualPickupTime: new Date(Date.now() - (i * 2 + 1) * 3600000), // hours ago
                actualDeliveryTime: new Date(Date.now() - (i * 2) * 3600000),
                stops: {
                    create: [
                        {
                            address: 'Andheri West, Mumbai',
                            latitude: 19.1136,
                            longitude: 72.8697,
                            sequence: 1,
                            isCompleted: true
                        }
                    ]
                }
            }
        });
    }

    console.log('Successfully seeded 3 completed trips for the driver.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
