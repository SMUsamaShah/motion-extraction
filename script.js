const video = document.getElementById('sVideo');
const originalCanvas = document.getElementById('originalCanvas');
const invertedCanvas = document.getElementById('invertedCanvas');
const originalCtx = originalCanvas.getContext('2d');
const invertedCtx = invertedCanvas.getContext('2d');

const rangeOpacity = document.getElementById('rangeOpacity');
const rangeDelay = document.getElementById('delay');

const maxFrames = 200;
const framesBuffer = new Array(maxFrames);
let frameDelay = 2;
let currentFrame = 0;
let lastPlayedTime = null;

const startButton = document.getElementById('startButton');
const videoFile = document.getElementById('videoFile');
const videoURL = document.getElementById('videoURL');
startButton.addEventListener('click', () => {
    if (videoFile.files.length > 0) {
        const url = URL.createObjectURL(videoFile.files[0]);
        loadVideo(url);
    } else if (videoURL.value !== '') {
        loadVideo(videoURL.value);
    } else {
        alert('Please select a file or enter a URL');
    }
});

function loadVideo(url) {
    video.src = url;
    video.load();
    video.play();
}

// Play the video once it is loaded
video.addEventListener('loadeddata', () => {
    originalCanvas.width = video.videoWidth;
    originalCanvas.height = video.videoHeight;
    invertedCanvas.width = video.videoWidth;
    invertedCanvas.height = video.videoHeight;
    function draw() {
        //skip duplicate frames
        var currentTime = video.currentTime;
        if (currentTime === lastPlayedTime) {
            requestAnimationFrame(draw);
            return;
        }
        lastPlayedTime = currentTime;

        // Draw video to original canvas
        originalCtx.drawImage(video, 0, 0, originalCanvas.width, originalCanvas.height);

        // Get frame data from original canvas and invert colors
        let imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
        let data = imageData.data;

        //Invert color of each pixel
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];         // red
            data[i + 1] = 255 - data[i + 1]; // green
            data[i + 2] = 255 - data[i + 2]; // blue
        }
        framesBuffer[currentFrame] = imageData;
        currentFrame = (currentFrame + 1) % maxFrames;

        let delayedFramee = framesBuffer[Math.abs((currentFrame + maxFrames - frameDelay) % maxFrames)];
        if (delayedFramee) {
            invertedCtx.putImageData(delayedFramee, 0, 0);
        }

        // Apply opacity from slider
        invertedCanvas.style.opacity = rangeOpacity.valueAsNumber;
        invertedCtx.globalCompositeOperation = "lighter";
        frameDelay = rangeDelay.valueAsNumber;

        requestAnimationFrame(draw);
    }
    draw();
});