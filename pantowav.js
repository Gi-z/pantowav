const MSADPCM = require("./msadpcm");

const fs = require("fs");
const SampleRate = require("node-libsamplerate");
const wav = require("wav");

if (process.argv.length < 3) {
    console.log("Usage: node popntowav ifs_file");
    process.exit();
}

let basename = process.argv[2];
let chartPath = process.argv[3];

let highestSample = 0;
//Outputting stereo 44.1Khz regardless.
const channels = 2;
const samplingRate = 44100;
//Because Int32.    
const bytes = 4;

//Get backing track.
let backingTrackPath = `temp\\${basename}\\${basename}.wav`;
console.log(backingTrackPath);
let backingTrackData = fs.readFileSync(backingTrackPath);
let decodedBackingTrack = MSADPCM.decodeKeysoundOut(backingTrackData);
let backsample = decodedBackingTrack.samplingRate;
decodedBackingTrack = decodedBackingTrack.data;

let options = {
    type: 0,
    channels: 2,
    fromDepth: 16,
    toDepth: 16,
    fromRate: backsample,
    toRate: samplingRate
}
let resample = new SampleRate(options);

resample.write(decodedBackingTrack);
decodedBackingTrack = Buffer.from(resample.read());

let chartData = fs.readFileSync(chartPath);
let chartEntry = JSON.parse(chartData);

let tracks = chartEntry.tracks;
console.log(tracks);
let notes = chartEntry.notes;

let tracksData = tracks.map((t) => {
    let trackDataLoc = `temp\\${t}`;
    if (!fs.existsSync(trackDataLoc)) {
        fs.mkdirSync(trackDataLoc);
    }

    let filelist = fs.readdirSync(trackDataLoc);
    let sortedfilelist = filelist.sort((a, b) => {
        return parseInt(a.split(".")[0]) - parseInt(b.split(".")[0]);
    });

    let data = sortedfilelist.map(file => {
        // console.log(trackDataLoc+"\\"+file);
        return fs.readFileSync(trackDataLoc+"\\"+file)
    });
    return data.map((d, i) => {
        let decodedKeysound = MSADPCM.decodeKeysoundOut(d);
        // if (decodedKeysound.samplingRate != samplingRate) {
        //     let options = {
        //         type: 0,
        //         channels: 2,
        //         fromDepth: 16,
        //         toDepth: 16,
        //         fromRate: decodedKeysound.samplingRate,
        //         toRate: samplingRate
        //     }
        //     let resample = new SampleRate(options);
            
        //     resample.write(decodedKeysound.data);
        //     decodedKeysound.data = Buffer.from(resample.read());
        // }

        return decodedKeysound;
    });
});

const lastNote = notes[notes.length-1];
const endOfSong = parseInt((lastNote.end_timing_msec*samplingRate)/1000)*channels*bytes+10000000;
console.log(endOfSong);

//Creating a buffer to store Int32s.
//This is overcompensating to deal with overflow from digital summing.
//Final Timestamp in milliseconds * sampling rate * 2 channels * 4 bytes.
const finalBuffer = Buffer.alloc(endOfSong);

for (var i = 0; i<decodedBackingTrack.length; i += 2) {
    let keysoundBytes = decodedBackingTrack.readInt16LE(i);

    highestSample = Math.max(Math.abs(keysoundBytes), highestSample);
    finalBuffer.writeInt32LE(keysoundBytes, i*2);
}

for (const note of notes) {
    const startOffset = note.start_timing_msec;
    const track_index = note.track_index;
    const scale_piano = note.scale_piano;
    const velocity = note.velocity;
    //Grabbing the relevant offset for the buffer.
    const convertedOffset = parseInt((startOffset*samplingRate)/1000)*channels*bytes;
    const keysound = tracksData[track_index][scale_piano];

    if (keysound) {
        const keysoundData = keysound.data;
        for (var i = 0; i<keysoundData.length; i += 2) {
            let keysoundBytes = keysoundData.readInt16LE(i);
            keysoundBytes *= velocity/100;

            if (convertedOffset+(i*2) < finalBuffer.length) {
                const finalBytes = finalBuffer.readInt32LE(convertedOffset+(i*2));
                let mixedBytes = keysoundBytes+finalBytes;

                highestSample = Math.max(Math.abs(mixedBytes), highestSample);
                finalBuffer.writeInt32LE(mixedBytes, convertedOffset+(i*2));
            }
        }
    }
}

// //We've got summed 16bit values, which means they won't fit into a 16bit buffer.
// //We also can't just shove them into a 32bit buffer, since they're 16bit scale.
// //Instead, we'll have to normalise them first using the peak observed volume.
// //2147483647 is just so I don't have to import a MAX_INT32 module.
// //After normalising, these values will be scaled correctly from 16bit to 32bit.
const normaliseFactor = parseInt(2147483647/highestSample);
for (var i = 0; i<finalBuffer.length; i += 4) {
    const buffBytes = finalBuffer.readInt32LE(i) * normaliseFactor;
    finalBuffer.writeInt32LE(buffBytes, i);
}

//I could manually generate a wav header, but I don't because I'm lazy.
let writer = new wav.FileWriter("output\\"+basename+".wav", {bitDepth: 32});
writer.write(finalBuffer);