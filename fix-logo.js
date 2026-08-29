const Jimp = require('jimp');

async function makeTransparent() {
  const image = await Jimp.read('images/logo.png');
  
  // Iterate through all pixels
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
    const r = this.bitmap.data[idx + 0];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    
    // If pixel is very close to white, make it fully transparent
    if (r > 240 && g > 240 && b > 240) {
      this.bitmap.data[idx + 3] = 0; // Alpha channel
    }
  });
  
  await image.writeAsync('images/logo.png');
  await image.writeAsync('images/logo-light.png');
  await image.writeAsync('images/logo-dark.png');
  console.log('Done!');
}
makeTransparent();
