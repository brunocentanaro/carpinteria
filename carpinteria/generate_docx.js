const fs = require("fs");
const path = require("path");
const docxPath = path.join(__dirname, "..", "web", "node_modules", "docx");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageBreak, HeadingLevel, Footer, PageNumber,
} = require(docxPath);

const input = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));
const outputPath = process.argv[3];
const firmaPath = path.join(__dirname, "assets", "firma_nilmo.png");
const firmaImg = fs.existsSync(firmaPath) ? fs.readFileSync(firmaPath) : null;

const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };
const money = (n) => "$" + Number(n).toLocaleString("es-UY", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const moneyFull = (n) => "$" + Number(n).toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const generalSpecs = input.general_specs || {};
const quotes = input.quotes || [];
const rut = input.rut || "216395620014";
const empresa = input.empresa || "Mundo Carpintero";
const representante = input.representante || "Nilmo Pirone";
const ci = input.ci || "11644968";
const licitacion = input.licitacion || "Licitación Abreviada N° 05/2026";
const organismo = input.organismo || "UTEC - Instituto Regional Norte";
const today = new Date().toLocaleDateString("es-UY", { year: "numeric", month: "long", day: "numeric" });

const children = [];

children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 200 },
  children: [new TextRun({ text: empresa, bold: true, size: 36, font: "Arial" })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 100 },
  children: [new TextRun({ text: `RUT: ${rut}`, size: 22, font: "Arial" })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 400 },
  children: [new TextRun({ text: `Fecha: ${today}`, size: 22, font: "Arial" })],
}));

children.push(new Paragraph({
  spacing: { after: 200 },
  children: [new TextRun({ text: licitacion, bold: true, size: 28, font: "Arial" })],
}));
children.push(new Paragraph({
  spacing: { after: 400 },
  children: [new TextRun({ text: organismo, size: 24, font: "Arial" })],
}));

children.push(new Paragraph({
  spacing: { after: 200 },
  children: [new TextRun({ text: "Items a Cotizar:", bold: true, size: 24, font: "Arial", underline: {} })],
}));

let grandTotal = 0;

for (const q of quotes) {
  if (q.has_error) continue;

  const unitTotal = q.total || 0;
  const qty = q.item_quantity || 1;
  const lineTotal = unitTotal * qty;
  grandTotal += lineTotal;

  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(new Paragraph({
    spacing: { before: 200, after: 200 },
    children: [new TextRun({
      text: `${q.item_code} - ${q.item_name}`,
      bold: true, size: 26, font: "Arial",
    })],
  }));

  const specRows = [];
  if (q.item_description) {
    specRows.push(["Descripcion", q.item_description]);
  }
  const dims = q.item_dimensions;
  if (dims && dims.width_mm) {
    specRows.push(["Dimensiones", `${dims.width_mm} x ${dims.height_mm}${dims.depth_mm ? " x " + dims.depth_mm : ""} mm`]);
  }
  if (q.item_material) specRows.push(["Material", q.item_material]);
  if (q.item_edge_banding) specRows.push(["Cantos", q.item_edge_banding]);
  if (q.item_hardware && q.item_hardware.length > 0) specRows.push(["Herrajes", q.item_hardware.join(", ")]);

  specRows.push(["Plazo de entrega", `${generalSpecs.delivery_days || 45} dias corridos`]);
  specRows.push(["Garantia", generalSpecs.product_warranty || "5 años"]);

  if (specRows.length > 0) {
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2800, 6560],
      rows: specRows.map(([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              borders, margins: cellMargins,
              width: { size: 2800, type: WidthType.DXA },
              shading: { fill: "E8EEF4", type: ShadingType.CLEAR },
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: "Arial" })] })],
            }),
            new TableCell({
              borders, margins: cellMargins,
              width: { size: 6560, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun({ text: String(value), size: 20, font: "Arial" })] })],
            }),
          ],
        })
      ),
    }));
  }

  children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));

  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders, margins: cellMargins,
            width: { size: 4680, type: WidthType.DXA },
            shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
            children: [new Paragraph({ children: [new TextRun({ text: "Precio Unitario (sin IVA)", bold: true, size: 22, font: "Arial" })] })],
          }),
          new TableCell({
            borders, margins: cellMargins,
            width: { size: 4680, type: WidthType.DXA },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `${moneyFull(unitTotal)} + IVA`, bold: true, size: 22, font: "Arial" })],
            })],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            borders, margins: cellMargins,
            width: { size: 4680, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: "Cantidad", size: 20, font: "Arial" })] })],
          }),
          new TableCell({
            borders, margins: cellMargins,
            width: { size: 4680, type: WidthType.DXA },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: String(qty), size: 20, font: "Arial" })],
            })],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            borders, margins: cellMargins,
            width: { size: 4680, type: WidthType.DXA },
            shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
            children: [new Paragraph({ children: [new TextRun({ text: "Precio Total (sin IVA)", bold: true, size: 22, font: "Arial" })] })],
          }),
          new TableCell({
            borders, margins: cellMargins,
            width: { size: 4680, type: WidthType.DXA },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `${moneyFull(lineTotal)} + IVA`, bold: true, size: 22, font: "Arial" })],
            })],
          }),
        ],
      }),
    ],
  }));
}

children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(new Paragraph({
  spacing: { after: 300 },
  children: [new TextRun({ text: "Resumen de Cotizacion", bold: true, size: 28, font: "Arial" })],
}));

const summaryRows = [
  new TableRow({
    children: ["Codigo", "Item", "Cant", "P. Unitario", "Total"].map((t, i) =>
      new TableCell({
        borders, margins: cellMargins,
        width: { size: [1200, 3500, 800, 1930, 1930][i], type: WidthType.DXA },
        shading: { fill: "4472C4", type: ShadingType.CLEAR },
        children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: "FFFFFF", size: 20, font: "Arial" })] })],
      })
    ),
  }),
];

for (const q of quotes) {
  if (q.has_error) continue;
  const ut = q.total || 0;
  const qty = q.item_quantity || 1;
  summaryRows.push(new TableRow({
    children: [q.item_code, q.item_name, String(qty), moneyFull(ut), moneyFull(ut * qty)].map((t, i) =>
      new TableCell({
        borders, margins: cellMargins,
        width: { size: [1200, 3500, 800, 1930, 1930][i], type: WidthType.DXA },
        children: [new Paragraph({
          alignment: i >= 3 ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text: t, size: 20, font: "Arial" })],
        })],
      })
    ),
  }));
}

summaryRows.push(new TableRow({
  children: [
    new TableCell({
      borders, margins: cellMargins, columnSpan: 4,
      width: { size: 7430, type: WidthType.DXA },
      shading: { fill: "E8EEF4", type: ShadingType.CLEAR },
      children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "TOTAL (sin IVA)", bold: true, size: 22, font: "Arial" })],
      })],
    }),
    new TableCell({
      borders, margins: cellMargins,
      width: { size: 1930, type: WidthType.DXA },
      shading: { fill: "E8EEF4", type: ShadingType.CLEAR },
      children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: moneyFull(grandTotal) + " + IVA", bold: true, size: 22, font: "Arial" })],
      })],
    }),
  ],
}));

children.push(new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [1200, 3500, 800, 1930, 1930],
  rows: summaryRows,
}));

children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));
children.push(new Paragraph({ children: [new TextRun({ text: "Moneda: Pesos Uruguayos", size: 22, font: "Arial" })] }));

children.push(new Paragraph({ spacing: { before: 400, after: 100 },
  children: [new TextRun({ text: "Condiciones Generales:", bold: true, size: 24, font: "Arial", underline: {} })],
}));

const conditions = [
  `Plazo de entrega: ${generalSpecs.delivery_days || 45} dias corridos`,
  "Pago: SIIF",
  `Mantenimiento de oferta: ${generalSpecs.offer_maintenance_days || 60} dias`,
  `Lugar de entrega: ${generalSpecs.delivery_location || "A coordinar"}`,
  `Garantia: ${generalSpecs.product_warranty || "5 años minimo"}`,
  "Los precios no incluyen IVA",
];
for (const cond of conditions) {
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: `- ${cond}`, size: 22, font: "Arial" })],
  }));
}

children.push(new Paragraph({ spacing: { before: 600, after: 100 },
  children: [new TextRun({ text: "Firma del representante:", bold: true, size: 22, font: "Arial" })],
}));

if (firmaImg) {
  children.push(new Paragraph({
    children: [new ImageRun({
      type: "png",
      data: firmaImg,
      transformation: { width: 180, height: 80 },
      altText: { title: "Firma", description: "Firma de Nilmo Pirone", name: "firma" },
    })],
  }));
}

children.push(new Paragraph({
  spacing: { before: 100 },
  children: [new TextRun({ text: representante, bold: true, size: 22, font: "Arial" })],
}));
children.push(new Paragraph({
  children: [new TextRun({ text: `CI: ${ci}`, size: 20, font: "Arial" })],
}));

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 24 } } },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `${empresa} - ${licitacion} - Pagina `, size: 16, font: "Arial", color: "888888" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: "888888" }),
          ],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outputPath, buffer);
  console.log(JSON.stringify({ path: outputPath }));
});
