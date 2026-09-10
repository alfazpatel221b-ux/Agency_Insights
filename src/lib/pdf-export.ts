'use client';

/**
 * Generates a high-fidelity PDF of the specified element.
 * uses dynamic imports to avoid SSR issues with DOM-heavy libraries.
 */
export async function exportToPdf(element: HTMLElement | null, month: string) {
  if (!element) return;

  try {
    // Dynamically import libraries to prevent server-side errors
    const { default: jsPDF } = await import('jspdf');
    const { default: html2canvas } = await import('html2canvas');

    const canvas = await html2canvas(element, {
      scale: 2, // High resolution
      useCORS: true,
      logging: false,
      backgroundColor: null, 
      onclone: (clonedDoc) => {
        // Ensure the cloned element for snapshotting is visible and correctly styled
        const el = clonedDoc.getElementById('snapshot-content');
        if (el) {
          el.style.padding = '20px';
          // Force a consistent background color for the capture
          el.style.backgroundColor = 'hsl(35 30% 95%)';
        }
      }
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    // Standard scaling to fit width
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`Agency_Snapshot_${month}.pdf`);
    
    return true;
  } catch (error) {
    console.error('PDF Export failed:', error);
    throw new Error('Failed to generate PDF. Please check your browser console for details.');
  }
}
