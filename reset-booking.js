const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const booking = await prisma.booking.update({
        where: { id: 'ebf33588-0679-49ad-ba49-1abfe6a19915' },
        data: {
            driverId: '22558a56-8316-4466-a7e3-35407eadd0d8',
            status: 'DRIVER_ASSIGNED'
        }
    });
    console.log('Reset booking status to:', booking.status);
}
main().catch(console.error).finally(() => prisma.$disconnect());
