const { createFFmpeg, fetchFile } = FFmpeg;
let ffmpeg;
let inputFile = null;

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const engineLoader = document.getElementById('engine-loader');
const convertBtn = document.getElementById('convert-btn');
const bpmInput = document.getElementById('bpm-input');
const bpmLabel = document.getElementById('bpm-label');

const initialStateDiv = document.getElementById('initial-state');
const fileLoadedStateDiv = document.getElementById('file-loaded-state');
const progressContainer = document.getElementById('progress-container');
const finishedStateDiv = document.getElementById('finished-state');

const filePreview = document.getElementById('file-preview');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const downloadBtn = document.getElementById('download-btn');
const startOverBtn = document.getElementById('start-over-btn');

// Player Elements
const previewAudio = document.getElementById('preview-audio');
const playBtn = document.getElementById('preview-play-btn');
const playIcon = playBtn.querySelector('.play-icon');
const pauseIcon = playBtn.querySelector('.pause-icon');
const seekbar = document.getElementById('preview-seekbar');
const currentTimeEl = document.getElementById('current-time');
const totalDurationEl = document.getElementById('total-duration');

// --- FFmpeg Setup ---
const loadFFmpeg = async () => {
    ffmpeg = createFFmpeg({
        log: false, // Set to true for deep debugging
        progress: ({ ratio }) => {
            const progress = Math.round(ratio * 100);
            if (progress > 0 && progress <= 100) {
                progressBar.value = progress;
                progressText.innerText = `Processing... ${progress}%`;
            }
        },
    });
    await ffmpeg.load();
    engineLoader.innerText = 'Audio engine loaded!';
    convertBtn.disabled = false;
};

// --- BPM Detection ---
const detectBPM = async (file) => {
    bpmLabel.innerText = "BPM (Detecting...)";
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        // Use the bpm-detective library function
        const bpm = await bpm_detective(audioBuffer);
        bpmInput.value = Math.round(bpm);
        bpmLabel.innerText = "BPM (Detected):";
    } catch (err) {
        console.error("BPM detection failed:", err);
        bpmLabel.innerText = "BPM (Detection failed):";
    }
};

// --- UI State Management ---
const showInitialState = () => {
    initialStateDiv.style.display = 'block';
    fileLoadedStateDiv.style.display = 'none';
    progressContainer.style.display = 'none';
    finishedStateDiv.style.display = 'none';
    dropZone.classList.remove('file-loaded');
    inputFile = null;
    fileInput.value = ''; // Reset file input
    previewAudio.pause();
    previewAudio.src = '';
};

const showFileLoadedState = (file) => {
    inputFile = file;
    initialStateDiv.style.display = 'none';
    fileLoadedStateDiv.style.display = 'block';
    progressContainer.style.display = 'none';
    finishedStateDiv.style.display = 'none';
    dropZone.classList.add('file-loaded');
    filePreview.innerHTML = `<p><strong>File:</strong> ${file.name}</p>`;
    detectBPM(file);
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
    
    // Setup download button
    downloadBtn.href = outputUrl;
    downloadBtn.download = outputFilename;

    // Setup player
    previewAudio.src = outputUrl;
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    seekbar.value = 0;
    currentTimeEl.textContent = "0:00";
};

// --- Helper Functions ---
const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

// --- Event Handlers ---
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });

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

startOverBtn.addEventListener('click', showInitialState);

// --- Player Event Handlers ---
playBtn.addEventListener('click', () => {
    if (previewAudio.paused) {
        previewAudio.play();
    } else {
        previewAudio.pause();
    }
});
previewAudio.addEventListener('play', () => {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
});
previewAudio.addEventListener('pause', () => {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
});
previewAudio.addEventListener('loadedmetadata', () => {
    totalDurationEl.textContent = formatTime(previewAudio.duration);
    seekbar.max = previewAudio.duration;
});
previewAudio.addEventListener('timeupdate', () => {
    currentTimeEl.textContent = formatTime(previewAudio.currentTime);
    seekbar.value = previewAudio.currentTime;
});
seekbar.addEventListener('click', (e) => {
    const rect = seekbar.getBoundingClientRect();
    const clickPosition = e.clientX - rect.left;
    const seekTime = (clickPosition / rect.width) * previewAudio.duration;
    previewAudio.currentTime = seekTime;
});

// --- Main Conversion Logic ---
convertBtn.addEventListener('click', async () => {
    if (!inputFile) return alert('No file selected!');

    showProcessingState();
    progressText.innerText = "Starting conversion...";

    // Generate filenames
    const inputFilename = 'input.mp3';
    const originalNameWithoutExt = inputFile.name.substring(0, inputFile.name.lastIndexOf('.'));
    const outputFilename = `${originalNameWithoutExt} (reversed).mp3`;

    // Get options from UI
    const speed = document.getElementById('speed-select').value;
    const conservePitch = document.getElementById('pitch-conserve').checked;
    const stereoShift = document.getElementById('stereo-shift-enable').checked;
    const bpm = bpmInput.value;

    try {
        progressText.innerText = "Loading file into memory...";
        ffmpeg.FS('writeFile', inputFilename, await fetchFile(inputFile));
        
        let filter_complex = [];
        let current_stream = "[0:a]";

        if (stereoShift) {
            const beatDurationMs = (60 / bpm) * 1000;
            const delayMs = Math.round(beatDurationMs * 2);
            filter_complex.push(`${current_stream}adelay=${delayMs}|${delayMs}[delayed]`);
            current_stream = "[delayed]";
        }

        filter_complex.push(`${current_stream}areverse[reversed]`);
        current_stream = "[reversed]";

        if (speed !== "1.0") {
            if (conservePitch) {
                let tempo = parseFloat(speed);
                let tempoFilters = [];
                while (tempo < 0.5) { tempoFilters.push('atempo=0.5'); tempo /= 0.5; }
                while (tempo > 2.0) { tempoFilters.push('atempo=2.0'); tempo /= 2.0; }
                if (tempo !== 1.0) { tempoFilters.push(`atempo=${tempo}`); }
                if (tempoFilters.length > 0) {
                    filter_complex.push(`${current_stream}${tempoFilters.join(',')}[spedup]`);
                    current_stream = "[spedup]";
                }
            } else {
                filter_complex.push(`${current_stream}asetrate=44100*${speed}[spedup]`);
                current_stream = "[spedup]";
            }
        }
        
        progressText.innerText = "Applying effects and reversing audio...";
        const command = ['-i', inputFilename, '-filter_complex', filter_complex.join(';'), '-map', current_stream, outputFilename];
        
        await ffmpeg.run(...command);
        
        progressText.innerText = "Finalizing file...";
        const data = ffmpeg.FS('readFile', outputFilename);
        const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);

        showFinishedState(url, outputFilename);

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