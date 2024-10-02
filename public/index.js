// public/app.js
const recordButton = document.getElementById('record');
const stopButton = document.getElementById('stop');
const audioPlayback = document.getElementById('audioPlayback');

let mediaRecorder;
let audioChunks = [];

recordButton.addEventListener('click', async () => {
  audioChunks = [];
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.start();

  mediaRecorder.addEventListener('dataavailable', (event) => {
    audioChunks.push(event.data);
  });

  mediaRecorder.addEventListener('stop', () => {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    sendAudioToServer(audioBlob);
  });

  recordButton.disabled = true;
  stopButton.disabled = false;
});

stopButton.addEventListener('click', () => {
  mediaRecorder.stop();
  recordButton.disabled = false;
  stopButton.disabled = true;
});

async function sendAudioToServer(audioBlob) {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'input.webm');

  const response = await fetch('http://localhost:3000/api/voice', {
    method: 'POST',
    body: formData,
  });

  if (response.ok) {
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    audioPlayback.src = audioUrl;
    audioPlayback.play();
  } else {
    console.error('Server error:', response.statusText);
  }
}
