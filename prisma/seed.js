const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const crypto = require('crypto');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL environment variable is missing!");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function main() {
  console.log('Clearing existing data...');
  await prisma.anomaly.deleteMany();
  await prisma.importLog.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.expenseSplit.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.groupMembership.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  console.log('Seeding users...');
  const hashedPassword = hashPassword('password123');

  const aisha = await prisma.user.create({
    data: { name: 'Aisha', email: 'aisha@splitshare.com', passwordHash: hashedPassword },
  });
  const rohan = await prisma.user.create({
    data: { name: 'Rohan', email: 'rohan@splitshare.com', passwordHash: hashedPassword },
  });
  const priya = await prisma.user.create({
    data: { name: 'Priya', email: 'priya@splitshare.com', passwordHash: hashedPassword },
  });
  const meera = await prisma.user.create({
    data: { name: 'Meera', email: 'meera@splitshare.com', passwordHash: hashedPassword },
  });
  const dev = await prisma.user.create({
    data: { name: 'Dev', email: 'dev@splitshare.com', passwordHash: hashedPassword },
  });
  const sam = await prisma.user.create({
    data: { name: 'Sam', email: 'sam@splitshare.com', passwordHash: hashedPassword },
  });

  console.log('Seeding groups...');
  const group = await prisma.group.create({
    data: {
      name: 'Flatmates Room',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    },
  });

  console.log('Seeding group memberships (with active periods)...');
  // Aisha, Rohan, Priya joined Feb 1st, still active
  await prisma.groupMembership.create({
    data: {
      groupId: group.id,
      userId: aisha.id,
      joinedAt: new Date('2026-02-01T00:00:00Z'),
      leftAt: null,
    },
  });
  await prisma.groupMembership.create({
    data: {
      groupId: group.id,
      userId: rohan.id,
      joinedAt: new Date('2026-02-01T00:00:00Z'),
      leftAt: null,
    },
  });
  await prisma.groupMembership.create({
    data: {
      groupId: group.id,
      userId: priya.id,
      joinedAt: new Date('2026-02-01T00:00:00Z'),
      leftAt: null,
    },
  });

  // Meera joined Feb 1st, moved out March 31st
  await prisma.groupMembership.create({
    data: {
      groupId: group.id,
      userId: meera.id,
      joinedAt: new Date('2026-02-01T00:00:00Z'),
      leftAt: new Date('2026-03-31T23:59:59Z'),
    },
  });

  // Sam joined mid-April (April 15th), still active
  await prisma.groupMembership.create({
    data: {
      groupId: group.id,
      userId: sam.id,
      joinedAt: new Date('2026-04-15T00:00:00Z'),
      leftAt: null,
    },
  });

  // Dev joined for a trip in March (joined March 1st, left March 15th)
  await prisma.groupMembership.create({
    data: {
      groupId: group.id,
      userId: dev.id,
      joinedAt: new Date('2026-03-01T00:00:00Z'),
      leftAt: new Date('2026-03-15T23:59:59Z'),
    },
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end(); // Make sure to close the pool to let the process exit
  });
