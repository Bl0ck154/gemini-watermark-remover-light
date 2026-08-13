const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const errorBox = document.querySelector('#error-box');

function showUnavailable() {
  errorBox.hidden = false;
  errorBox.textContent = 'The standalone web-processing runtime is not included in this build. Use the Install userscript button above for the supported version.';
}

if (dropZone && fileInput && errorBox) {
  dropZone.addEventListener('click', (event) => {
    event.preventDefault();
    showUnavailable();
  });
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      showUnavailable();
    }
  });
}
