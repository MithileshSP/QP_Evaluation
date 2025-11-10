import * as XLSX from "xlsx";

/**
 * Extract register number from submission
 * Tries multiple sources in order of preference
 */
function extractRegisterNumber(submission) {
  // Try explicit register number field
  if (submission.registerNumber) {
    return submission.registerNumber;
  }

  // Try to extract from title
  if (submission.title) {
    // Look for patterns like "REG123", "2021BCS001", etc.
    const regMatch = submission.title.match(
      /\b(?:REG|REGNO|ROLL|ID)?\s*(\d{2,}[A-Z]{0,5}\d*)\b/i
    );
    if (regMatch) {
      return regMatch[1];
    }
  }

  // Try to extract from filename
  if (submission.fileName) {
    const fileMatch = submission.fileName.match(/\b(\d{2,}[A-Z]{0,5}\d*)\b/i);
    if (fileMatch) {
      return fileMatch[1];
    }
  }

  // Try from transcript or metadata if available
  if (submission.transcript) {
    const transcriptMatch = submission.transcript.match(
      /(?:register|roll|student)\s*(?:number|no|id)?\s*:?\s*(\d{2,}[A-Z]{0,5}\d*)/i
    );
    if (transcriptMatch) {
      return transcriptMatch[1];
    }
  }

  // Fallback to filename without extension
  if (submission.fileName) {
    return submission.fileName.replace(/\.[^/.]+$/, "");
  }

  return "N/A";
}

/**
 * Generate Excel workbook from bulk batch submissions
 */
export function generateBulkExcel(batch) {
  if (!batch || !batch.submissions || batch.submissions.length === 0) {
    throw new Error("No submissions to export");
  }

  const submissions = batch.submissions;

  // Prepare data rows
  const rows = submissions.map((submission) => {
    const registerNumber = extractRegisterNumber(submission);
    const row = {
      "Register Number": registerNumber,
      "Student Name": submission.title || submission.fileName || "N/A",
    };

    // Add individual question scores
    if (submission.breakdown && Array.isArray(submission.breakdown)) {
      submission.breakdown.forEach((question) => {
        const qNum = question.questionNumber || question.question || "?";
        const score = question.score ?? 0;
        const maxScore = question.maxScore ?? 0;
        row[`Q${qNum}`] = score;
        row[`Q${qNum} (Max)`] = maxScore;
      });
    }

    // Add total score
    const totalScore = submission.score ?? 0;
    const maxScore = submission.maxScore ?? 0;
    row["Total Score"] = totalScore;
    row["Max Score"] = maxScore;
    row["Percentage"] =
      maxScore > 0 ? ((totalScore / maxScore) * 100).toFixed(2) + "%" : "N/A";

    return row;
  });

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const columnWidths = Object.keys(rows[0] || {}).map((key) => ({
    wch: Math.max(key.length, 15),
  }));
  worksheet["!cols"] = columnWidths;

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    batch.title?.substring(0, 31) || "Results"
  );

  // Generate filename
  const timestamp = new Date().toISOString().split("T")[0];
  const batchName = (batch.title || "bulk-evaluation")
    .replace(/[^a-z0-9]/gi, "_")
    .substring(0, 30);
  const filename = `${batchName}_${timestamp}.xlsx`;

  // Download file
  XLSX.writeFile(workbook, filename);

  return filename;
}

/**
 * Generate a detailed Excel with separate sheets for overview and detailed breakdown
 */
export function generateDetailedBulkExcel(batch) {
  if (!batch || !batch.submissions || batch.submissions.length === 0) {
    throw new Error("No submissions to export");
  }

  const submissions = batch.submissions;
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary/Overview
  const summaryRows = submissions.map((submission) => ({
    "Register Number": extractRegisterNumber(submission),
    "Student Name": submission.title || submission.fileName || "N/A",
    "Total Score": submission.score ?? 0,
    "Max Score": submission.maxScore ?? 0,
    Percentage:
      submission.maxScore > 0
        ? ((submission.score / submission.maxScore) * 100).toFixed(2) + "%"
        : "N/A",
    "Evaluated On": submission.createdAt
      ? new Date(submission.createdAt).toLocaleString()
      : "N/A",
  }));

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet["!cols"] = [
    { wch: 18 },
    { wch: 25 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  // Sheet 2: Detailed Breakdown
  const detailRows = [];
  submissions.forEach((submission) => {
    const registerNumber = extractRegisterNumber(submission);
    const studentName = submission.title || submission.fileName || "N/A";

    if (submission.breakdown && Array.isArray(submission.breakdown)) {
      submission.breakdown.forEach((question) => {
        detailRows.push({
          "Register Number": registerNumber,
          "Student Name": studentName,
          Question: question.questionNumber || question.question || "?",
          Score: question.score ?? 0,
          "Max Score": question.maxScore ?? 0,
          Percentage:
            question.maxScore > 0
              ? ((question.score / question.maxScore) * 100).toFixed(2) + "%"
              : "N/A",
          Feedback: question.reason || "",
        });
      });
    }
  });

  if (detailRows.length > 0) {
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    detailSheet["!cols"] = [
      { wch: 18 },
      { wch: 25 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 50 },
    ];
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Detailed Breakdown");
  }

  // Generate filename
  const timestamp = new Date().toISOString().split("T")[0];
  const batchName = (batch.title || "bulk-evaluation")
    .replace(/[^a-z0-9]/gi, "_")
    .substring(0, 30);
  const filename = `${batchName}_detailed_${timestamp}.xlsx`;

  // Download file
  XLSX.writeFile(workbook, filename);

  return filename;
}
