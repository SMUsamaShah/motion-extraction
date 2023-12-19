// here you can interact with the popup slider controls and message the content script with updated values
document.getElementById("startButton").addEventListener("click", function () {
    let rangeOpacity = document.getElementById("rangeOpacity").value;
    let rangeDelay = document.getElementById("rangeDelay").value;
  
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "start", frameDelay: rangeDelay, opacity: rangeOpacity }, function (response) {
        console.log(response);
      });
    });
  });
  