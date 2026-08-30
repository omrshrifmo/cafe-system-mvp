/**
 * Durable ESC/POS Print Outbox Background Worker
 */
const net = require('net');
const { allQuery, runQuery } = require('../db/connection');
const { formatReceiptEscPos, formatKitchenTicketEscPos, formatZReportEscPos } = require('../domain/printing/service');
const logger = require('../observability/logger');

let isRunning = false;
const fs = require('fs');
let workerTimer = null;

async function sendRawBufferToPrinter(ipOrPath, port, buffer, timeoutMs = 4000) {
  // Check if target is a local USB device path (e.g. /dev/usb/lp0)
  if (typeof ipOrPath === 'string' && (ipOrPath.startsWith('/') || ipOrPath.startsWith('\\\\.\\') || ipOrPath.toLowerCase().includes('usb'))) {
    return new Promise((resolve, reject) => {
      try {
        fs.writeFile(ipOrPath, buffer, (err) => {
          if (err) return reject(new Error(`USB Printer write error on ${ipOrPath}: ${err.message}`));
          resolve({ success: true, interface: 'USB' });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Otherwise treat as Network TCP Thermal Printer
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let isSettled = false;

    socket.setTimeout(timeoutMs);

    socket.connect(port || 9100, ipOrPath, () => {
      socket.write(buffer, () => {
        socket.end();
      });
    });

    socket.on('close', () => {
      if (!isSettled) {
        isSettled = true;
        resolve({ success: true, interface: 'NETWORK' });
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      if (!isSettled) {
        isSettled = true;
        reject(new Error(`Printer TCP timeout on ${ipOrPath}:${port}`));
      }
    });

    socket.on('error', (err) => {
      socket.destroy();
      if (!isSettled) {
        isSettled = true;
        reject(err);
      }
    });
  });
}

async function processPendingPrintJobs() {
  try {
    const jobs = await allQuery(
      `SELECT * FROM print_jobs 
       WHERE status IN ('PENDING', 'RETRYING') 
         AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now', 'localtime'))
       ORDER BY created_at ASC LIMIT 5`
    );

    for (const job of jobs) {
      let payload = {};
      try { payload = JSON.parse(job.payload_json); } catch (e) {}

      let rawBuffer = null;
      if (job.job_type === 'RECEIPT') {
        rawBuffer = formatReceiptEscPos(payload);
      } else if (job.job_type === 'KITCHEN_TICKET') {
        rawBuffer = formatKitchenTicketEscPos(payload);
      } else if (job.job_type === 'Z_REPORT') {
        rawBuffer = formatZReportEscPos(payload);
      } else {
        rawBuffer = Buffer.from(job.payload_json, 'utf8');
      }

      try {
        await sendRawBufferToPrinter(job.printer_ip, job.printer_port, rawBuffer);
        await runQuery(
          `UPDATE print_jobs SET status = 'COMPLETED', printed_at = datetime('now', 'localtime') WHERE id = ?`,
          [job.id]
        );
        logger.info('Print job completed successfully', { jobId: job.id, type: job.job_type });
      } catch (err) {
        const nextAttempts = job.attempts + 1;
        const newStatus = nextAttempts >= job.max_attempts ? 'FAILED' : 'RETRYING';
        const backoffSeconds = Math.min(300, Math.pow(2, nextAttempts) * 5);

        await runQuery(
          `UPDATE print_jobs 
           SET status = ?, attempts = ?, last_error = ?,
               next_attempt_at = datetime('now', 'localtime', '+${backoffSeconds} seconds')
           WHERE id = ?`,
          [newStatus, nextAttempts, err.message, job.id]
        );

        logger.warn(`Print job attempt ${nextAttempts} failed, status: ${newStatus}`, {
          jobId: job.id,
          error: err.message
        });
      }
    }
  } catch (e) {
    logger.error('Error in print worker loop', { error: e.message });
  }
}

function startPrintWorker(intervalMs = 3000) {
  if (isRunning) return;
  isRunning = true;
  logger.info('Starting durable ESC/POS print outbox worker');
  
  workerTimer = setInterval(() => {
    processPendingPrintJobs().catch(() => {});
  }, intervalMs);
}

function stopPrintWorker() {
  isRunning = false;
  if (workerTimer) clearInterval(workerTimer);
}

module.exports = {
  startPrintWorker,
  stopPrintWorker,
  processPendingPrintJobs,
  sendRawBufferToPrinter
};
