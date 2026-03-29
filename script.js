/* Version: #4 */

// === KONFIGURASJON OG GLOBAL TILSTAND ===
const state = {
    imageLoaded: false,
    originalWidth: 0,
    originalHeight: 0,
    aspectRatio: 1
};

// DOM Elementer
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const canvas = document.getElementById('image-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const generateBtn = document.getElementById('generate-btn');
const statusMsg = document.getElementById('status-message');

// Input Elementer
const inputMaxThickness = document.getElementById('max-thickness');
const inputMinThickness = document.getElementById('min-thickness');
const inputWidth = document.getElementById('output-width');
const inputInvert = document.getElementById('invert-colors');

console.log("System: Lithophane Generator Versjon #4 initialisert.");

// === EVENT LISTENERS ===

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleImage(files[0]);
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleImage(e.target.files[0]);
});

generateBtn.addEventListener('click', () => generateSTL());

// === BILDEBEHANDLING ===

function handleImage(file) {
    console.log(`Fil mottatt: ${file.name} (${file.size} bytes)`);
    
    if (!file.type.match('image.*')) {
        updateStatus("Feil: Filen må være et bilde!", "red");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            console.log(`Bilde lastet suksessfullt. Opprinnelig størrelse: ${img.width}x${img.height}`);
            
            // Begrens canvas-størrelse for ytelse (maks 500px bredde for forhåndsvisning)
            const scaleFactor = Math.min(1, 500 / img.width);
            canvas.width = img.width * scaleFactor;
            canvas.height = img.height * scaleFactor;
            
            state.originalWidth = img.width;
            state.originalHeight = img.height;
            state.aspectRatio = img.height / img.width;
            state.imageLoaded = true;

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            updateStatus("Bilde lastet. Klar til å generere STL.", "green");
            generateBtn.disabled = false;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function updateStatus(msg, color) {
    statusMsg.innerText = msg;
    statusMsg.style.color = color === "green" ? "var(--success-color)" : (color === "red" ? "#ef4444" : "var(--primary-color)");
    console.log(`Status: ${msg}`);
}

// === STL GENERERING (MATEMATIKK OG EKSPORT) ===

async function generateSTL() {
    console.log("Starter STL-generering (Solid-modell)...");
    updateStatus("Prosesserer geometri...", "blue");

    const width = parseInt(inputWidth.value);
    const height = Math.round(width * state.aspectRatio);
    const maxT = parseFloat(inputMaxThickness.value);
    const minT = parseFloat(inputMinThickness.value);
    const invert = inputInvert.checked;

    // Vi bruker en grid-oppløsning basert på canvas-størrelsen for å unngå krasj
    const gridX = canvas.width;
    const gridY = canvas.height;
    const imgData = ctx.getImageData(0, 0, gridX, gridY).data;

    // Beregn tykkelse for hvert punkt
    const thicknessMap = [];
    for (let y = 0; y < gridY; y++) {
        for (let x = 0; x < gridX; x++) {
            const idx = (y * gridX + x) * 4;
            // Gråskala (Luminans-formel: 0.299R + 0.587G + 0.114B)
            let avg = (imgData[idx] * 0.299 + imgData[idx + 1] * 0.587 + imgData[idx + 2] * 0.114) / 255;
            
            if (invert) avg = 1 - avg; // Mørke partier blir tykke
            
            const t = minT + (avg * (maxT - minT));
            thicknessMap.push(t);
        }
    }

    console.log(`Tykkelseskart generert (${thicknessMap.length} punkter).`);

    // Konstruer binær STL (nå med bunn og sider)
    try {
        const blob = createBinarySTL(gridX, gridY, width, height, thicknessMap);
        downloadBlob(blob, "lithophane.stl");
        updateStatus("STL ferdig generert og lastet ned!", "green");
    } catch (err) {
        console.error("Feil under STL-bygging:", err);
        updateStatus("Feil under generering.", "red");
    }
}

function createBinarySTL(gridX, gridY, physicalWidth, physicalHeight, thicknessMap) {
    // === 1. BEREGN ANTALL TRIANGLER ===
    const numTopp = (gridX - 1) * (gridY - 1) * 2;
    const numBunn = (gridX - 1) * (gridY - 1) * 2;
    const numSideV_X = (gridX - 1) * 2; // Sidevegger langs topp/bunn kant
    const numSideV_Y = (gridY - 1) * 2; // Sidevegger langs venstre/høyre kant
    
    const numTriangles = numTopp + numBunn + (numSideV_X * 2) + (numSideV_Y * 2);
    
    console.log(`Genererer solid modell. Totalt antall triangler: ${numTriangles}`);
    console.log(`- Toppflate: ${numTopp}`);
    console.log(`- Bunnflate: ${numBunn}`);
    console.log(`- Sidevegger: ${numSideV_X * 2 + numSideV_Y * 2}`);

    const bufferSize = 84 + (numTriangles * 50);
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    
    // 80 bytes header (alt til 0)
    for (let i = 0; i < 80; i++) view.setUint8(i, 0);
    
    // Antall triangler (4 bytes)
    view.setUint32(80, numTriangles, true);
    
    let offset = 84;
    const pixelSizeX = physicalWidth / (gridX - 1);
    const pixelSizeY = physicalHeight / (gridY - 1);

    // === 2. GENERER GEOMETRI (SKRIV TIL BUFFER) ===

    for (let y = 0; y < gridY - 1; y++) {
        for (let x = 0; x < gridX - 1; x++) {
            // Definer 4 hjørner i en rute for topp og bunn
            
            // Toppflate (Z = tykkelseskart)
            const pt1 = { x: x * pixelSizeX, y: y * pixelSizeY, z: thicknessMap[y * gridX + x] };
            const pt2 = { x: (x + 1) * pixelSizeX, y: y * pixelSizeY, z: thicknessMap[y * gridX + (x + 1)] };
            const pt3 = { x: x * pixelSizeX, y: (y + 1) * pixelSizeY, z: thicknessMap[(y + 1) * gridX + x] };
            const pt4 = { x: (x + 1) * pixelSizeX, y: (y + 1) * pixelSizeY, z: thicknessMap[(y + 1) * gridX + (x + 1)] };

            // Bunnflate (Z = 0)
            const pb1 = { x: x * pixelSizeX, y: y * pixelSizeY, z: 0 };
            const pb2 = { x: (x + 1) * pixelSizeX, y: y * pixelSizeY, z: 0 };
            const pb3 = { x: x * pixelSizeX, y: (y + 1) * pixelSizeY, z: 0 };
            const pb4 = { x: (x + 1) * pixelSizeX, y: (y + 1) * pixelSizeY, z: 0 };

            // Trekant 1 (pt1, pt2, pt3) - Toppflate
            writeTriangle(view, offset, pt1, pt2, pt3);
            offset += 50;
            // Trekant 2 (pt2, pt4, pt3) - Toppflate
            writeTriangle(view, offset, pt2, pt4, pt3);
            offset += 50;
            
            // Trekant 3 (pb1, pb3, pb2) - Bunnflate (Invertert rekkefølge for Normal)
            writeTriangle(view, offset, pb1, pb3, pb2);
            offset += 50;
            // Trekant 4 (pb2, pb3, pb4) - Bunnflate (Invertert rekkefølge for Normal)
            writeTriangle(view, offset, pb2, pb3, pb4);
            offset += 50;

            // === 3. GENERER SIDEVEGGER HVIS PÅ KANT ===
            
            // Venstre kant (x = 0)
            if (x === 0) {
                writeTriangle(view, offset, pt1, pb1, pt3); offset += 50;
                writeTriangle(view, offset, pb1, pb3, pt3); offset += 50;
            }
            // Høyre kant (x = gridX - 2)
            if (x === gridX - 2) {
                writeTriangle(view, offset, pt2, pt4, pb2); offset += 50;
                writeTriangle(view, offset, pb2, pt4, pb4); offset += 50;
            }
            // Toppkant (y = 0)
            if (y === 0) {
                writeTriangle(view, offset, pt1, pt2, pb1); offset += 50;
                writeTriangle(view, offset, pb1, pt2, pb2); offset += 50;
            }
            // Bunnkant (y = gridY - 2)
            if (y === gridY - 2) {
                writeTriangle(view, offset, pt3, pb3, pt4); offset += 50;
                writeTriangle(view, offset, pb3, pb4, pt4); offset += 50;
            }
        }
    }

    console.log(`Binær buffer ferdigstilt (Solid modell). Størrelse: ${bufferSize} bytes.`);
    return new Blob([buffer], { type: 'application/sla' });
}

function writeTriangle(view, offset, p1, p2, p3) {
    // Normal (setter til 0, de fleste slicere beregner dette selv)
    view.setFloat32(offset + 0, 0, true);
    view.setFloat32(offset + 4, 0, true);
    view.setFloat32(offset + 8, 0, true);
    
    // Vertex 1
    view.setFloat32(offset + 12, p1.x, true);
    view.setFloat32(offset + 16, p1.y, true);
    view.setFloat32(offset + 20, p1.z, true);
    
    // Vertex 2
    view.setFloat32(offset + 24, p2.x, true);
    view.setFloat32(offset + 28, p2.y, true);
    view.setFloat32(offset + 32, p2.z, true);
    
    // Vertex 3
    view.setFloat32(offset + 36, p3.x, true);
    view.setFloat32(offset + 40, p3.y, true);
    view.setFloat32(offset + 44, p3.z, true);
    
    // Attribute byte count
    view.setUint16(offset + 48, 0, true);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    console.log(`Nedlasting startet: ${filename}`);
}

/* Version: #4 */
