const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');

async function buildPdf(pdfPath, invId, snapshot, liveOrder, company) {
  // Use snapshot for items and totals, but liveOrder for statuses
  const order = snapshot;
  const statusOrder = liveOrder || snapshot;

  let logoBuffer = null;
  let localPngLogo = null;
  try {
    const localLogoPath = path.join(__dirname, '..', '..', 'images', 'logo.png');
    if (fs.existsSync(localLogoPath)) {
      localPngLogo = localLogoPath;
    }
  } catch(e) {}

  if (!localPngLogo && company.logoUrl && company.logoUrl.startsWith('http')) {
    try {
      const fetch = require('node:http');
      const https = require('node:https');
      const client = company.logoUrl.startsWith('https') ? https : fetch;
      logoBuffer = await new Promise((resolve) => {
        client.get(company.logoUrl, (res) => {
          if (res.statusCode !== 200) return resolve(null);
          const data = [];
          res.on('data', chunk => data.push(chunk));
          res.on('end', () => resolve(Buffer.concat(data)));
        }).on('error', () => resolve(null));
      });
    } catch (err) {
      console.error('Failed to fetch remote logo:', err);
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Colors (Elegant Black & Gold theme for PDF)
    const C_BLACK = '#1a1a1a';
    const C_GOLD = '#602442';
    const C_CREAM = '#fcf8f2';
    const C_TEXT = '#333333';
    const C_MUTED = '#888888';
    const C_BORDER = '#eaeaea';

    // --- HEADER ---
    let startY = 50;
    if (localPngLogo) {
      try {
        doc.image(localPngLogo, 50, startY - 20, { width: 140 });
      } catch(e) {
        doc.fontSize(24).fillColor(C_GOLD).font('Helvetica-Bold').text(company.name, 50, startY);
      }
    } else if (logoBuffer) {
      try {
        doc.image(logoBuffer, 50, startY - 10, { height: 40 });
      } catch(e) {
        doc.fontSize(24).fillColor(C_GOLD).font('Helvetica-Bold').text(company.name, 50, startY);
      }
    } else {
      doc.fontSize(24).fillColor(C_GOLD).font('Helvetica-Bold').text(company.name, 50, startY);
    }

    // Company Details (under logo)
    doc.fontSize(8).fillColor(C_MUTED).font('Helvetica');
    const fWeb = company.website || 'tovessa.com';
    const fEmail = company.email || 'tovessa@gmail.com';
    const fPhone = company.phone || '+92 301 4617844';
    const fInsta = company.instagram || 'tovessa';
    const fAddr = company.address || 'Lahore, Punjab, Pakistan';

    const logoYOffset = startY + 60; // Shift down to make room for logo

    doc.text(fWeb, 50, logoYOffset, { link: 'https://' + fWeb.replace(/^https?:\/\//, '') });
    doc.text(fEmail, 50, logoYOffset + 12, { link: 'mailto:' + fEmail });
    doc.text(fPhone, 50, logoYOffset + 24, { link: 'https://wa.me/' + fPhone.replace(/[\+\s]/g, '') });
    
    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#888888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>`;
    SVGtoPDF(doc, instaSvg, 50, logoYOffset + 34, { width: 10, height: 10 });
    doc.text(fInsta, 65, logoYOffset + 36, { link: 'https://instagram.com/' + fInsta.replace('@', '') });
    
    doc.text(fAddr, 50, logoYOffset + 48, { width: 200 });
    
    // Divider
    doc.moveTo(50, startY + 125).lineTo(545, startY + 125).stroke(C_GOLD);

    // Company Info (Right aligned)
    doc.fontSize(24).fillColor(C_BLACK).font('Helvetica-Bold').text('INVOICE', 350, startY, { align: 'right', width: 195 });
    
    const isCod = order.paymentMethod === 'cod';
    if (isCod) {
       doc.rect(470, startY + 28, 75, 14).fillAndStroke(C_BLACK, C_BLACK);
       doc.fontSize(8).fillColor(C_GOLD).font('Helvetica-Bold').text('COD ORDER', 470, startY + 31, { align: 'center', width: 75 });
    }

    doc.fontSize(9).fillColor(C_TEXT).font('Helvetica');
    doc.text(`Invoice / Order No:   ${invId}`, 350, startY + 55, { align: 'right', width: 195 });
    doc.text(`Invoice Date:   ${new Date().toLocaleDateString()}`, 350, startY + 70, { align: 'right', width: 195 });
    doc.text(`Payment Method:   ${isCod ? 'Cash on Delivery (COD)' : 'Online'}`, 350, startY + 85, { align: 'right', width: 195 });
    doc.text(`Invoice Status:   Generated`, 350, startY + 100, { align: 'right', width: 195 });

    // BILL TO (Left aligned styled card)
    let billY = startY + 150;
    doc.rect(50, billY, 250, 105).fillAndStroke(C_CREAM, C_BORDER);
    doc.fillColor(C_BLACK).fontSize(9).font('Helvetica-Bold').text('BILL TO', 65, billY + 15);
    const cName = order.customerName || `${order.delivery?.fname || ''} ${order.delivery?.lname || ''}`.trim() || 'Valued Customer';
    const cPhone = order.phone || order.delivery?.phone || 'N/A';
    const cEmail = order.email || order.delivery?.email || order.customerEmail || '';
    const cCity = order.city || order.delivery?.city || '';
    const fullAddr = order.delivery?.address || order.address || '';
    const cAddress = fullAddr ? `${fullAddr}, ${cCity}` : cCity;

    doc.fontSize(9).font('Helvetica').fillColor(C_TEXT);
    doc.text(cName, 65, billY + 30, { width: 220 });
    doc.fillColor(C_MUTED);
    doc.text(cPhone, 65, billY + 45, { width: 220 });
    doc.text(cEmail, 65, billY + 58, { width: 220 });
    doc.text(cAddress, 65, billY + 70, { width: 220 });

    // --- TABLE HEADER ---
    let y = billY + 135;
    doc.rect(50, y, 495, 25).fillAndStroke(C_CREAM, C_CREAM);
    doc.fillColor(C_BLACK).font('Helvetica-Bold').fontSize(9);
    doc.text('ITEMS', 60, y + 8);
    doc.text('PRICE', 300, y + 8, { width: 80, align: 'right' });
    doc.text('QTY', 390, y + 8, { width: 50, align: 'center' });
    doc.text('TOTAL', 450, y + 8, { width: 85, align: 'right' });
    
    y += 25;

    // --- TABLE ROWS ---
    doc.font('Helvetica').fillColor(C_TEXT);
    (order.items || []).forEach(item => {
      const itemTotal = (item.price * item.qty);
      doc.fillColor(C_TEXT).fontSize(9);
      const nameHeight = doc.heightOfString(item.name, { width: 230 });
      const rowHeight = Math.max(40, nameHeight + 25);
      
      doc.rect(50, y, 495, rowHeight).fillAndStroke('#ffffff', '#ffffff');
      doc.fillColor(C_TEXT);
      doc.text(item.name, 60, y + 10, { width: 230 });
      doc.fillColor(C_MUTED).fontSize(8).text(`SKU: ${item.sku || 'N/A'}`, 60, y + 10 + nameHeight + 4);
      doc.fillColor(C_TEXT).fontSize(9);
      doc.text(`PKR ${item.price.toLocaleString()}`, 300, y + 15, { width: 80, align: 'right' });
      doc.text(item.qty.toString(), 390, y + 15, { width: 50, align: 'center' });
      doc.text(`PKR ${itemTotal.toLocaleString()}`, 450, y + 15, { width: 85, align: 'right' });
      y += rowHeight;
      doc.moveTo(50, y).lineTo(545, y).stroke(C_BORDER);
    });
    y += 15;

    // --- TOTALS SUMMARY CARD ---
    doc.rect(340, y, 205, 120).fillAndStroke(C_CREAM, C_BORDER);
    let ty = y + 15;
    
    doc.fontSize(9).fillColor(C_TEXT).font('Helvetica');
    doc.text('Subtotal', 355, ty, { width: 80, align: 'left' });
    doc.text(`PKR ${(order.subtotal || 0).toLocaleString()}`, 445, ty, { width: 85, align: 'right' });
    ty += 20;

    if (order.discount > 0) {
      doc.text('Discount', 355, ty, { width: 80, align: 'left' });
      doc.text(`- PKR ${(order.discount).toLocaleString()}`, 445, ty, { width: 85, align: 'right' });
      ty += 20;
    }

    if ((order.deliveryFee || 0) > 0) {
      doc.text('Delivery Fee', 355, ty, { width: 80, align: 'left' });
      doc.text(`PKR ${(order.deliveryFee || 0).toLocaleString()}`, 445, ty, { width: 85, align: 'right' });
      ty += 20;
    }

    doc.moveTo(355, ty).lineTo(530, ty).stroke(C_BORDER);
    ty += 15;

    doc.fontSize(11).font('Helvetica-Bold').fillColor(C_BLACK);
    doc.text('Grand Total', 355, ty, { width: 80, align: 'left' });
    doc.text(`PKR ${(order.total || 0).toLocaleString()}`, 445, ty, { width: 85, align: 'right' });
    y += 140;

    // --- ADVANCE & COD BOX ---
    const advancePaid = Number(statusOrder.advanceAmount) || Number(order.advanceAmount) || 0;
    const remaining = isCod ? Math.max(0, (order.total || 0) - advancePaid) : 0;
    
    doc.rect(50, y, 280, 85).fillAndStroke(C_CREAM, C_BORDER);
    doc.fillColor(C_BLACK).fontSize(9).font('Helvetica-Bold');
    doc.text('Advance Paid', 65, y + 15);
    doc.text(`PKR ${advancePaid.toLocaleString()}`, 200, y + 15, { width: 110, align: 'left' });
    doc.font('Helvetica').fillColor(C_MUTED);
    doc.text('Advance Method', 65, y + 30);
    doc.text(statusOrder.advanceMethod || order.advanceMethod || '—', 200, y + 30, { width: 110, align: 'left' });
    doc.text('Reference No', 65, y + 45);
    doc.text(statusOrder.advanceRef || order.advanceRef || '—', 200, y + 45, { width: 110, align: 'left' });
    doc.text('Advance Date', 65, y + 60);
    const advDate = statusOrder.advanceDate || order.advanceDate;
    doc.text(advDate ? new Date(advDate).toLocaleDateString() : '—', 200, y + 60, { width: 110, align: 'left' });

    // Highlight Box (Rounded)
    doc.roundedRect(340, y, 205, 85, 4).fillAndStroke(C_BLACK, C_GOLD);
    doc.fillColor(C_GOLD).font('Helvetica').fontSize(10);
    doc.text(isCod ? 'REMAINING TO COLLECT (COD)' : 'REMAINING BALANCE', 340, y + 25, { align: 'center', width: 205 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff');
    doc.text(`PKR ${remaining.toLocaleString()}`, 340, y + 45, { align: 'center', width: 205 });

    y += 105;

    // --- STATUS BADGES ---
    const oStatus = statusOrder.status || 'Pending';
    const deliveryStatus = oStatus === 'Pending' ? 'Not Shipped' :
                           oStatus === 'Processing' ? 'Preparing Shipment' :
                           oStatus === 'Shipped' ? 'In Transit' :
                           oStatus === 'Delivered' ? 'Delivered' :
                           oStatus === 'Cancelled' ? 'Cancelled' : 'Not Shipped';
                           
    let pStatus = 'Unpaid';
    if (advancePaid > 0) {
      pStatus = advancePaid >= (order.total || 0) ? 'Paid' : 'Partial (Advance)';
    } else if (!isCod) {
      pStatus = 'Paid';
    }

    doc.rect(50, y, 495, 40).fillAndStroke(C_CREAM, C_CREAM);
    doc.fillColor(C_TEXT).fontSize(8).font('Helvetica-Bold');
    doc.text('Order Status', 90, y + 12);
    doc.font('Helvetica').text(oStatus, 90, y + 24);

    doc.font('Helvetica-Bold').text('Payment Status', 200, y + 12);
    doc.font('Helvetica').text(pStatus, 200, y + 24);
    
    doc.font('Helvetica-Bold').text('Advance Status', 320, y + 12);
    doc.font('Helvetica').text(statusOrder.advanceStatus || '—', 320, y + 24);

    doc.font('Helvetica-Bold').text('Delivery Status', 430, y + 12);
    doc.font('Helvetica').text(deliveryStatus, 430, y + 24);

    // --- FOOTER ---
    const oldBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.rect(0, 780, 600, 65).fillAndStroke(C_BLACK, C_BLACK);
    doc.fillColor(C_GOLD).fontSize(9).font('Helvetica-Bold');
    doc.text(`Thank you for shopping with Tovessa!`, 0, 795, { align: 'center', width: 600 });
    doc.fillColor('#dddddd').fontSize(8).font('Helvetica');
    doc.text(`${fWeb}   |   ${fEmail}   |   ${fPhone}`, 0, 810, { align: 'center', width: 600 });

    doc.page.margins.bottom = oldBottomMargin;

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = { buildPdf };
