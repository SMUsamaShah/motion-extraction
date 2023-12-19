const video = document.querySelector('video');
let originalCanvas;
let invertedCanvas;
let originalCtx;
let invertedCtx;

let maxFrames = 200;
let framesBuffer = new Array(maxFrames);
let frameDelay = 2;
let currentFrame = 0;
let lastPlayedTime = null;
let opacity = 0.5; // initial value

if (video) {
  originalCanvas = document.createElement('canvas');
  invertedCanvas = document.createElement('canvas');

  originalCanvas.id = 'originalCanvas';
  invertedCanvas.id = 'invertedCanvas';

  document.body.appendChild(originalCanvas);
  let videoContainer = document.querySelector("#movie_player > div.html5-video-container");
  videoContainer.appendChild(invertedCanvas);
  
  originalCtx = originalCanvas.getContext('2d');
  invertedCtx = invertedCanvas.getContext('2d');
  
  originalCanvas.width = video.videoWidth;
  originalCanvas.height = video.videoHeight;
  invertedCanvas.width = video.videoWidth;
  invertedCanvas.height = video.videoHeight;

  originalCanvas.style.display = "none";
  
  invertedCanvas.style.opacity = opacity;
  invertedCtx.globalCompositeOperation = "lighter";
    
  function draw() {
    // skip duplicate frames
    let currentTime = video.currentTime;
    if (currentTime === lastPlayedTime) {
      requestAnimationFrame(draw);
      return;
    }
    lastPlayedTime = currentTime;

    // Draw video to original canvas
    originalCtx.drawImage(video, 0, 0, originalCanvas.width, originalCanvas.height);
    originalCtx.wi

    // Get frame data from original canvas and invert colors
    let imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
    let data = imageData.data;

    // Invert color of each pixel
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i]; // red
        data[i + 1] = 255 - data[i + 1]; // green
        data[i + 2] = 255 - data[i + 2]; // blue
    }
    framesBuffer[currentFrame] = imageData;
    currentFrame = (currentFrame + 1) % maxFrames;

    let delayedFramee = framesBuffer[Math.abs((currentFrame + maxFrames - frameDelay) % maxFrames)];
    if (delayedFramee) {
        invertedCtx.putImageData(delayedFramee, 0, 0);
    }

    // Apply opacity value
    invertedCanvas.style.opacity = opacity;

    requestAnimationFrame(draw);
  }
  draw();
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if(request.action === "start") {
        frameDelay = Number(request.frameDelay);
        opacity = Number(request.opacity);
        sendResponse({status: "Started"});
    }
});
