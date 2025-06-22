const { createFFmpeg, fetchFile } = FFmpeg;
let ffmpeg;
let inputFile = null;

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const engineLoader = document.getElementById('engine-loader');
const convertBtn = document.getElementById('convert-btn');

const initialStateDiv = document.getElementById('initial-state');
const fileLoadedStateDiv = document.getElementById('file-loaded-state');
const progressContainer = document.getElementById('progress-container');
const finishedStateDiv = document.getElementById('finished-state');

const filePreview = document.getElementById('file-preview');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const downloadBtn = document.getElementById('download-btn');
const startOverBtn = document.getElementById('start-over-btn');

// --- FFmpeg Setup ---
const loadFFmpeg = async () => {
    ffmpeg = createFFmpeg({
        log: true, // Set to true for debugging in the console
        progress: ({ ratio }) => {
            const progress = Math.round(ratio * 100);
            progressBar.value = progress;
            progressText.innerText = `Processing... ${progress}%`;
        },
    });
    await ffmpeg.load();
    engineLoader.innerText = 'Audio engine loaded!';
    convertBtn.disabled = false;
};

// --- State Management ---
const showInitialState = () => {
    initialStateDiv.style.display = 'block';
    fileLoadedStateDiv.style.display = 'none';
    progressContainer.style.display = 'none';
    finishedStateDiv.style.display = 'none';
    dropZone.classList.remove('file-loaded');
    inputFile = null;
    fileInput.value = ''; // Reset file input
};

const showFileLoadedState = (file) => {
    inputFile = file;
    initialStateDiv.style.display = 'none';
    fileLoadedStateDiv.style.display = 'block';
    progressContainer.style.display = 'none';
    finishedStateDiv.style.display = 'none';
    dropZone.classList.add('file-loaded');
    filePreview.innerHTML = `<p><strong>File:</strong> ${file.name}</p>`;
};

const showProcessingState = () => {
    fileLoadedStateDiv.style.display = 'none';
    progressContainer.style.display = 'block';
    finishedStateDiv.style.display = 'none';
    convertBtn.disabled = true;
};

const showFinishedState = (outputUrl, outputFilename) => {
    progressContainer.style.display = 'none';
    finishedStateDiv.style.display = 'block';
    downloadBtn.href = outputUrl;
    downloadBtn.download = outputFilename;
};

// --- Event Handlers ---
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'audio/mpeg') {
        showFileLoadedState(files[0]);
    } else {
        alert('Please drop an MP3 file.');
    }
});

fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length > 0) {
        showFileLoadedState(files[0]);
    }
});

startOverBtn.addEventListener('click', () => {
    showInitialState();
});

convertBtn.addEventListener('click', async () => {
    if (!inputFile) {
        alert('No file selected!');
        return;
    }

    showProcessingState();
    progressText.innerText = "Starting conversion...";

    const inputFilename = 'input.mp3';
    const outputFilename = 'reversed_output.mp3';

    // Get options from UI
    const speed = document.getElementById('speed-select').value;
    const conservePitch = document.getElementById('pitch-conserve').checked;
    const stereoShift = document.getElementById('stereo-shift-enable').checked;
    const bpm = document.getElementById('bpm-input').value;

    try {
        // 1. Write file to FFmpeg's virtual file system
        progressText.innerText = "Loading file into memory...";
        ffmpeg.FS('writeFile', inputFilename, await fetchFile(inputFile));
        
        // 2. Build the complex filter command
        let filter_complex = [];
        let current_stream = "[0:a]"; // Initial audio stream

        // Stereo Shift Filter (if enabled)
        if (stereoShift) {
            // Calculate delay in milliseconds for 2 beats
            const beatDurationMs = (60 / bpm) * 1000;
            const delayMs = Math.round(beatDurationMs * 2);
            // We delay the right channel. | separates delays for each channel. 0|1000 means left has 0ms delay, right has 1000ms.
            filter_complex.push(`${current_stream}adelay=${delayMs}|${delayMs}[delayed]`);
            current_stream = "[delayed]";
        }

        // Reverse Filter (always on)
        filter_complex.push(`${current_stream}areverse[reversed]`);
        current_stream = "[reversed]";

        // Speed/Pitch Filter
        if (speed !== "1.0") {
            if (conservePitch) {
                // atempo filter changes tempo without changing pitch. Valid range 0.5-100.0.
                // We might need to chain them if speed is < 0.5.
                let tempo = parseFloat(speed);
                let tempoFilters = [];
                // FFmpeg atempo filter can only be between 0.5 and 2.0 in some versions. Modern ones support up to 100.
                // To be safe, we chain them for values outside 0.5-2.0
                while (tempo < 0.5) {
                    tempoFilters.push('atempo=0.5');
                    tempo /= 0.5;
                }
                while (tempo > 2.0) {
                    tempoFilters.push('atempo=2.0');
                    tempo /= 2.0;
                }
                if (tempo !== 1.0) {
                   tempoFilters.push(`atempo=${tempo}`);
                }
                if (tempoFilters.length > 0) {
                    filter_complex.push(`${current_stream}${tempoFilters.join(',')}[spedup]`);
                    current_stream = "[spedup]";
                }
            } else {
                // asetrate filter changes tempo AND pitch.
                // We get the original sample rate (assumed 44100) and multiply by speed.
                filter_complex.push(`${current_stream}asetrate=44100*${speed}[spedup]`);
                current_stream = "[spedup]";
            }
        }
        
        // 3. Run FFmpeg command
        progressText.innerText = "Applying effects and reversing audio...";
        const command = ['-i', inputFilename, '-filter_complex', filter_complex.join(';'), '-map', current_stream, outputFilename];
        console.log("Running FFmpeg with command:", command.join(' '));
        
        await ffmpeg.run(...command);
        
        // 4. Get the result
        progressText.innerText = "Finalizing file...";
        const data = ffmpeg.FS('readFile', outputFilename);
        const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);

        showFinishedState(url, outputFilename);

        // 5. Clean up virtual file system
        ffmpeg.FS('unlink', inputFilename);
        ffmpeg.FS('unlink', outputFilename);

    } catch (error) {
        console.error(error);
        alert('An error occurred during conversion. Check the console for details.');
        showFileLoadedState(inputFile); // Go back to options
        convertBtn.disabled = false;
    }
});

// --- Initialize App ---
loadFFmpeg();
showInitialState();