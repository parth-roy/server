import { PrismaClient, VehicleType, BookingStatus, PaymentStatus, PaymentMethod, UserRole, DriverStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

// ---------------------------------------------------------
// REALISTIC GEODATA (Mumbai, Delhi, Bangalore)
// ---------------------------------------------------------
const LOCATIONS = {
  Mumbai: [
    { label: 'Andheri West', lat: 19.1363, lng: 72.8276, address: 'Link Road, Andheri West, Mumbai' },
    { label: 'Bandra Kurla Complex', lat: 19.0657, lng: 72.8643, address: 'BKC, Bandra East, Mumbai' },
    { label: 'Lower Parel', lat: 18.9950, lng: 72.8250, address: 'Senapati Bapat Marg, Lower Parel, Mumbai' },
    { label: 'Powai', lat: 19.1176, lng: 72.9060, address: 'Hiranandani Gardens, Powai, Mumbai' }
  ],
  Delhi: [
    { label: 'Connaught Place', lat: 28.6304, lng: 77.2177, address: 'Rajiv Chowk, Connaught Place, New Delhi' },
    { label: 'Dwarka Sector 21', lat: 28.5524, lng: 77.0583, address: 'Sector 21, Dwarka, New Delhi' },
    { label: 'Vasant Kunj', lat: 28.5293, lng: 77.1533, address: 'Nelson Mandela Marg, Vasant Kunj, New Delhi' },
    { label: 'Noida Sector 62', lat: 28.6276, lng: 77.3721, address: 'Electronic City, Sector 62, Noida' }
  ],
  Bangalore: [
    { label: 'Koramangala', lat: 12.9352, lng: 77.6245, address: '80 Feet Road, Koramangala, Bangalore' },
    { label: 'Indiranagar', lat: 12.9784, lng: 77.6408, address: '100 Feet Road, Indiranagar, Bangalore' },
    { label: 'Electronic City', lat: 12.8452, lng: 77.6602, address: 'Phase 1, Electronic City, Bangalore' },
    { label: 'Whitefield', lat: 12.9698, lng: 77.7499, address: 'ITPL Main Road, Whitefield, Bangalore' }
  ]
};

// Calculate realistic distance in km between two lat/lng pairs
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Generate random points between A and B for En Route simulation
function getIntermediatePoint(lat1: number, lng1: number, lat2: number, lng2: number, fraction: number) {
  return { lat: lat1 + (lat2 - lat1) * fraction, lng: lng1 + (lng2 - lng1) * fraction };
}

async function clearDatabase() {
  console.log('Wiping database for a clean start...');
  const tableNames = [
    'verification_logs', 'driver_earnings', 'fleet_earnings', 'fleet_truck_usage', 'truck_assignments',
    'booking_location_history', 'booking_stops', 'bids', 'bookings',
    'support_messages', 'support_tickets', 'fleet_maintenance', 'fleet_fuel_logs', 'fleet_truck_documents', 'fleet_trucks', 'fleet_drivers',
    'fleet_wallet_transactions', 'fleet_wallets', 'fleet_owners',
    'driver_documents', 'drivers', 'vehicles',
    'saved_addresses', 'recent_searches', 'gst_details', 'team_members',
    'wallet_transactions', 'wallets', 'coin_transactions', 'coin_balances',
    'user_notifications', 'refresh_tokens', 'users'
  ];

  for (const table of tableNames) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch (e) {
      console.log(`Failed to truncate ${table}`);
    }
  }
}

async function seedVehiclePricing() {
  console.log('Seeding vehicle pricing...');
  const vehiclePricing = [
    { vehicleType: VehicleType.BIKE, baseFare: 40, pricePerKm: 10, minFare: 60, capacityKg: 30, capacityDesc: '30 kg - Documents, small parcels', estimatedEta: 5, displayName: 'Bike' },
    { vehicleType: VehicleType.THREE_WHEELER, baseFare: 80, pricePerKm: 15, minFare: 150, capacityKg: 500, capacityDesc: '500 kg - Small goods, furniture', estimatedEta: 8, displayName: '3 Wheeler' },
    { vehicleType: VehicleType.TATA_ACE, baseFare: 150, pricePerKm: 20, minFare: 300, capacityKg: 750, capacityDesc: '750 kg - Small business delivery', estimatedEta: 15, displayName: 'Tata Ace' },
    { vehicleType: VehicleType.MINI_TRUCK, baseFare: 250, pricePerKm: 25, minFare: 500, capacityKg: 1500, capacityDesc: '1500 kg - Large delivery, shifting', estimatedEta: 20, displayName: 'Mini Truck' },
  ];
  for (const v of vehiclePricing) {
    await prisma.vehicleTypePricing.upsert({ where: { vehicleType: v.vehicleType }, update: v, create: v });
  }
}

async function main() {
  await clearDatabase();
  await seedVehiclePricing();

  console.log('Generating Customers...');
  const customers = [];
  for (let i = 1; i <= 5; i++) {
    const user = await prisma.user.create({
      data: {
        id: uuidv4(), phone: `900000000${i}`, name: `Customer ${i}`, email: `customer${i}@test.com`,
        role: UserRole.CUSTOMER, profileComplete: true, isActive: true,
        wallet: { create: { cachedBalance: 500 } }
      }
    });
    customers.push(user);
  }

  console.log('Generating Fleet Owners...');
  const fleets = [];
  const cities = ['Mumbai', 'Delhi', 'Bangalore'];
  for (let i = 1; i <= 3; i++) {
    const city = cities[i-1];
    const user = await prisma.user.create({
      data: {
        id: uuidv4(), phone: `800000000${i}`, name: `Fleet Owner ${city}`,
        role: UserRole.FLEET_OWNER, profileComplete: true, isActive: true,
        fleetOwner: {
          create: { companyName: `${city} Express Logistics`, isActive: true }
        }
      },
      include: { fleetOwner: true }
    });
    fleets.push({ user, fleetOwner: user.fleetOwner!, city });
  }

  console.log('Generating Trucks and Fleet Drivers...');
  let totalDrivers = 0;
  const allDrivers = [];
  
  for (const fleet of fleets) {
    const fleetCityLocations = LOCATIONS[fleet.city as keyof typeof LOCATIONS];
    
    // Create 4 trucks and 4 drivers per fleet
    for (let j = 1; j <= 4; j++) {
      totalDrivers++;
      
      // Truck
      const truck = await prisma.fleetTruck.create({
        data: {
          fleetOwnerId: fleet.fleetOwner.id,
          registrationNo: `${fleet.city.substring(0,2).toUpperCase()}01AB${1000 + totalDrivers}`,
          type: j % 2 === 0 ? VehicleType.TATA_ACE : VehicleType.THREE_WHEELER,
          make: 'Tata', model: 'Ace Gold', capacityKg: 750, isActive: true,
          currentLat: fleetCityLocations[0].lat + (Math.random() * 0.02),
          currentLng: fleetCityLocations[0].lng + (Math.random() * 0.02)
        }
      });

      // Driver User
      const driverUser = await prisma.user.create({
        data: {
          id: uuidv4(), phone: `7000000${100 + totalDrivers}`, name: `${fleet.city} Driver ${j}`,
          role: UserRole.DRIVER, profileComplete: true, isActive: true,
          driver: {
            create: {
              licenseNumber: `DL${100000 + totalDrivers}`,
              status: j === 1 ? DriverStatus.ON_TRIP : DriverStatus.AVAILABLE,
              isDocVerified: true, rating: 4.5 + (Math.random() * 0.5),
              fleetMemberships: { create: { fleetOwnerId: fleet.fleetOwner.id } }
            }
          }
        },
        include: { driver: { include: { fleetMemberships: true } } }
      });
      
      const driverProfile = driverUser.driver!;
      allDrivers.push({ driver: driverProfile, fleet, truck });
    }
  }

  console.log('Generating Realistic Bookings...');
  for (const driverData of allDrivers) {
    const { driver, fleet, truck } = driverData;
    const city = fleet.city as keyof typeof LOCATIONS;
    const locs = LOCATIONS[city];
    
    // Each driver gets 2 Completed bookings and 1 active
    for (let b = 0; b < 3; b++) {
      const isCompleted = b < 2;
      const pickup = locs[b % locs.length];
      const dropoff = locs[(b + 1) % locs.length];
      const distance = getDistanceFromLatLonInKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
      
      // Calculate fare
      const pricing = await prisma.vehicleTypePricing.findUnique({ where: { vehicleType: truck.type } });
      const totalFare = Math.max(pricing!.minFare, pricing!.baseFare + (distance * pricing!.pricePerKm));
      const driverPayout = totalFare * 0.8;
      const netAmount = totalFare - driverPayout;

      // Random Customer
      const customer = customers[Math.floor(Math.random() * customers.length)];

      let status: BookingStatus = BookingStatus.COMPLETED;
      let currentLat: number = dropoff.lat;
      let currentLng: number = dropoff.lng;

      if (!isCompleted) {
         if (driver.status === DriverStatus.ON_TRIP) {
             status = BookingStatus.IN_TRANSIT;
             const mid = getIntermediatePoint(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, 0.5); // Halfway
             currentLat = mid.lat;
             currentLng = mid.lng;
         } else {
             status = BookingStatus.CONFIRMED; // Waiting for assignment
         }
      }

      const booking = await prisma.booking.create({
        data: {
          bookingNumber: `BKG-${Date.now()}-${b}`,
          customerId: customer.id,
          driverId: status !== BookingStatus.CONFIRMED ? driver.id : null,
          pickupAddress: pickup.address, pickupLat: pickup.lat, pickupLng: pickup.lng,
          vehicleType: truck.type, status: status,
          baseFare: pricing!.baseFare, distanceFare: distance * pricing!.pricePerKm,
          totalFare: totalFare, paymentStatus: PaymentStatus.PAID, paymentMethod: PaymentMethod.WALLET,
          estimatedDistance: distance,
          estimatedDuration: Math.round(distance * 3), // approx 3 mins per km
          stops: {
            create: { sequence: 1, address: dropoff.address, latitude: dropoff.lat, longitude: dropoff.lng, isCompleted: isCompleted }
          }
        }
      });

      if (status !== BookingStatus.CONFIRMED) {
        // Create Truck Assignment
        const fleetDriver = driver.fleetMemberships[0];
        await prisma.truckAssignment.create({
          data: {
            bookingId: booking.id, fleetOwnerId: fleet.fleetOwner.id,
            fleetDriverId: fleetDriver.id, truckId: truck.id
          }
        });

        // Current truck location update
        await prisma.fleetTruck.update({
          where: { id: truck.id },
          data: { currentLat: currentLat, currentLng: currentLng, currentDriverId: fleetDriver.id }
        });

        if (status === BookingStatus.IN_TRANSIT) {
          // Driver location history (simulating moving)
          for(let m = 0; m < 5; m++) {
            const histLoc = getIntermediatePoint(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, m * 0.1);
            await prisma.bookingLocationHistory.create({
              data: { bookingId: booking.id, latitude: histLoc.lat, longitude: histLoc.lng }
            });
          }
        }

        if (isCompleted) {
          await prisma.driverEarning.create({
            data: { driverId: driver.id, bookingId: booking.id, grossAmount: totalFare, commission: totalFare - driverPayout, netAmount: driverPayout }
          });
          await prisma.fleetEarning.create({
            data: { fleetOwnerId: fleet.fleetOwner.id, bookingId: booking.id, grossAmount: totalFare, driverPayout: driverPayout, netAmount: netAmount }
          });
        }
      }
    }
  }

  console.log('Seeding Complete! Database is populated with realistic routes in Mumbai, Delhi, and Bangalore.');
}

main().catch(console.error).finally(() => prisma.$disconnect());