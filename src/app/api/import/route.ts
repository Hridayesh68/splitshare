import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseCSV, validateCSVRows } from '@/lib/csv-parser';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const groupId = formData.get('groupId') as string | null;

    if (!file || !groupId) {
      return NextResponse.json(
        { error: 'File and groupId are required' },
        { status: 400 }
      );
    }

    const csvContent = await file.text();
    const rawRows = parseCSV(csvContent);

    // Run core validation
    const { anomalies } = await validateCSVRows(rawRows, groupId);

    // Save import metadata and anomalies to the database for staging
    const importLog = await prisma.$transaction(async (tx) => {
      const log = await tx.importLog.create({
        data: {
          fileName: file.name,
          status: anomalies.length > 0 ? 'PENDING' : 'COMPLETED',
        },
      });

      if (anomalies.length > 0) {
        await tx.anomaly.createMany({
          data: anomalies.map(a => ({
            importLogId: log.id,
            rowNumber: a.rowNumber,
            columnName: a.columnName || null,
            rawValue: a.rawValue || null,
            errorType: a.errorType,
            description: a.description,
            resolutionPolicy: a.suggestedResolution, // Stash the suggested strategy
            status: 'PENDING',
          })),
        });
      }

      return log;
    });

    // Fetch the anomalies we just created to return them with IDs
    const savedAnomalies = await prisma.anomaly.findMany({
      where: { importLogId: importLog.id },
    });

    // If there were zero anomalies, we can proceed to auto-import valid rows!
    // But since the assignment specifies Meera wants to approve changes and logs must be created,
    // returning the import status and logs is standard.
    return NextResponse.json({
      importLogId: importLog.id,
      status: importLog.status,
      anomalies: savedAnomalies,
      totalRowsParsed: rawRows.length,
      rows: rawRows,
    });
  } catch (error: any) {
    console.error('CSV Import error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const importLogId = searchParams.get('importLogId');

    if (!importLogId) {
      // Return list of all imports
      const imports = await prisma.importLog.findMany({
        include: { _count: { select: { anomalies: true } } },
        orderBy: { importedAt: 'desc' },
      });
      return NextResponse.json(imports);
    }

    const importLog = await prisma.importLog.findUnique({
      where: { id: importLogId },
      include: { anomalies: true },
    });

    if (!importLog) {
      return NextResponse.json(
        { error: 'Import log not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(importLog);
  } catch (error: any) {
    console.error('Fetch import log error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
