import { PrismaClient, VehicleType, UserRole, DriverStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  const driverId = uuidv4();
  const phone = `8000000${Math.floor(Math.random() * 1000)}`;

  console.log('Creating a dummy THREE_WHEELER driver...');

  // 1. Create User
  await prisma.user.create({
    data: {
      id: driverId,
      phone: phone,
      name: 'Dummy Auto Driver',
      email: `dummy_auto_${phone}@test.com`,
      role: UserRole.DRIVER,
      profileComplete: true,
      isActive: true,
      wallet: { create: { cachedBalance: 0 } },
    },
  });

  // 2. Create Vehicle
  const vehicle = await prisma.vehicle.create({
    data: {
      type: VehicleType.THREE_WHEELER,
      registrationNo: `REG-AW-${Math.floor(Math.random() * 99999)}`,
      make: 'Bajaj',
      model: 'Maxima',
      year: 2022,
      capacityKg: 500,
      isActive: true,
    },
  });

  // 3. Create Driver Profile
  await prisma.driver.create({
    data: {
      id: driverId,
      userId: driverId,
      status: DriverStatus.AVAILABLE,
      isDocVerified: true,
      isActive: true,
      vehicleId: vehicle.id,
      currentLat: 22.8,
      currentLng: 88.4,
      licenseNumber: `DL-AW-${Math.floor(Math.random() * 9999999)}`,
    },
  });

  console.log('Successfully created available THREE_WHEELER driver!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
