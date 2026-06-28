import { PrismaClient, VehicleType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const dummyVehicles = [
    {
      vehicleType: VehicleType.BIKE,
      displayName: 'Bike',
      baseFare: 40,
      pricePerKm: 10,
      minFare: 50,
      capacityKg: 20,
      capacityDesc: 'Small parcels, documents',
      estimatedEta: 5,
      isActive: true,
      imageUrl: 'https://cdn-icons-png.flaticon.com/512/3133/3133647.png'
    },
    {
      vehicleType: VehicleType.THREE_WHEELER,
      displayName: 'Three Wheeler',
      baseFare: 100,
      pricePerKm: 15,
      minFare: 120,
      capacityKg: 500,
      capacityDesc: 'Medium boxes, electronics',
      estimatedEta: 10,
      isActive: true,
      imageUrl: 'https://cdn-icons-png.flaticon.com/512/2855/2855639.png'
    },
    {
      vehicleType: VehicleType.TATA_ACE,
      displayName: 'Tata Ace',
      baseFare: 250,
      pricePerKm: 25,
      minFare: 300,
      capacityKg: 750,
      capacityDesc: 'Furniture, small moves',
      estimatedEta: 15,
      isActive: true,
      imageUrl: 'https://cdn-icons-png.flaticon.com/512/2765/2765063.png'
    },
    {
      vehicleType: VehicleType.MINI_TRUCK,
      displayName: 'Mini Truck',
      baseFare: 400,
      pricePerKm: 40,
      minFare: 500,
      capacityKg: 1500,
      capacityDesc: 'Heavy loads, large moves',
      estimatedEta: 20,
      isActive: true,
      imageUrl: 'https://cdn-icons-png.flaticon.com/512/2765/2765063.png'
    }
  ];

  console.log('Inserting dummy vehicles...');
  
  for (const vehicle of dummyVehicles) {
    await prisma.vehicleTypePricing.upsert({
      where: { vehicleType: vehicle.vehicleType },
      update: vehicle,
      create: vehicle,
    });
  }

  console.log('Successfully inserted dummy vehicles!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
