// =============================
// 本実験用プログラム
// 必要ファイル:
//   画像/画像ファイル名
//   音声/音声ファイル名
//   グループ振り分け.csv
//   音声対応表.csv
// =============================

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzG5DFOYpKXdrkBSwkzi-jF4Tujn4fpBu3Bd_2KD6FtXmg3RtmcfxMPrKA_gLMTBGJj_A/exec";
const IMAGE_FOLDER = "画像/";
const AUDIO_FOLDER = "音声/";
const GROUP_FILE = "グループ振り分け.csv";
const AUDIO_MAPPING_FILE = "音声対応表.csv";

// 以前の予備実験と同じカテゴリ順：人形 → 音声なし → 音声あり
const CATEGORY_ORDER = ["A", "B", "C"];
const CATEGORY_LABELS = {
  A: "人形",
  B: "スマートスピーカー（音声なし）",
  C: "スマートスピーカー（音声あり）"
};
const AUDIO_CATEGORY = "C";
const FIXATION_MS = 1000;
const AUDIO_PLAY_MS = 1000; // 以前の予備実験と同じく、各音声の先頭1秒を再生

let participantId = "";
let groupsByCategory = {};
let audioMapping = new Map();
let trials = [];
let trialIndex = 0;
let results = [];
let currentAudio = null;
let audioStopTimer = null;
let currentTrial = null;
let isPlayingAudio = false;

const statusText = document.getElementById("status");
const startScreen = document.getElementById("startScreen");
const startButton = document.getElementById("startButton");
const experiment = document.getElementById("experiment");
const progressText = document.getElementById("progress");
const fixation = document.getElementById("fixation");
const pairArea = document.getElementById("pairArea");
const leftImage = document.getElementById("leftImage");
const rightImage = document.getElementById("rightImage");
const audioStatus = document.getElementById("audioStatus");
// 音声再生中のスピーカーマーク
const leftSpeaker = document.getElementById("leftSpeaker");
const rightSpeaker = document.getElementById("rightSpeaker");

// もう一度聞くボタン
const audioReplayButton = document.getElementById("audioReplayButton");
const ratingButtons = [...document.querySelectorAll("#ratingButtons button")];
const completeScreen = document.getElementById("complete");
const completeMessage = document.getElementById("completeMessage");
const categoryTransition = document.getElementById("categoryTransition");
const categoryTransitionTitle = document.getElementById("categoryTransitionTitle");
const categoryTransitionMessage = document.getElementById("categoryTransitionMessage");
const nextCategoryButton = document.getElementById("nextCategoryButton");

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function parseCSVLine(line) {
  // 今回のCSVはカンマを含まないファイル名を想定
  return line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
}

async function loadCSV(path) {
  const response = await fetch(path + "?t=" + Date.now());
  if (!response.ok) throw new Error(`${path}を読み込めません。ファイルの場所を確認してください。`);
  return (await response.text()).replace(/^\uFEFF/, "");
}

function cleanRows(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

async function loadGroupAssignments() {
  const text = await loadCSV(GROUP_FILE);
  const rows = cleanRows(text);
  const groups = { A: {}, C: {}, B: {} };

  for (const row of rows) {
    const cols = parseCSVLine(row);
    if (cols[0] === "カテゴリ" || cols[0].toLowerCase() === "category") continue;
    if (cols.length < 3) throw new Error("グループ振り分け.csvは「カテゴリ,グループ番号,画像ファイル名」の3列にしてください。");

    const [category, groupRaw, imageName] = cols;
    const groupNo = Number(groupRaw);

    if (!groups[category]) throw new Error(`カテゴリ名が正しくありません: ${category}（A・C・Bを使用してください）`);
    if (!Number.isInteger(groupNo) || groupNo < 1 || groupNo > 8) throw new Error(`グループ番号が正しくありません: ${groupRaw}`);
    if (!/^\d{3}\.(png|jpg|jpeg|webp)$/i.test(imageName)) throw new Error(`画像ファイル名が正しくありません: ${imageName}`);

    if (!groups[category][groupNo]) groups[category][groupNo] = [];
    groups[category][groupNo].push(imageName);
  }

  for (const category of CATEGORY_ORDER) {
    for (let groupNo = 1; groupNo <= 8; groupNo++) {
      const images = groups[category][groupNo];
      if (!images || images.length !== 9 || new Set(images).size !== 9) {
        throw new Error(`${category}カテゴリの${groupNo}グループは、重複なしの画像9枚が必要です。`);
      }
    }
    const all = Object.values(groups[category]).flat();
    if (all.length !== 72 || new Set(all).size !== 72) {
      throw new Error(`${category}カテゴリ内で画像が重複しているか、画像数が72枚ではありません。`);
    }
  }

  return groups;
}

async function loadAudioMapping() {
  const text = await loadCSV(AUDIO_MAPPING_FILE);
  const rows = cleanRows(text);
  const mapping = new Map();

  for (const row of rows) {
    const cols = parseCSVLine(row);
    if (cols[0] === "画像ファイル名" || cols[0].toLowerCase() === "image") continue;
    if (cols.length < 2) throw new Error("音声対応表.csvは「画像ファイル名,音声ファイル名」の2列にしてください。");

    const [imageName, audioName] = cols;
    if (!/^\d{3}\.(png|jpg|jpeg|webp)$/i.test(imageName)) throw new Error(`音声対応表の画像名が正しくありません: ${imageName}`);
    if (!/^voice\d{3}\.wav$/i.test(audioName)) throw new Error(`音声ファイル名が正しくありません: ${audioName}`);
    if (mapping.has(imageName)) throw new Error(`音声対応表で画像が重複しています: ${imageName}`);
    mapping.set(imageName, audioName);
  }
  return mapping;
}

function buildTrials() {
  const allTrials = [];

  for (const category of CATEGORY_ORDER) {
    for (let groupNo = 1; groupNo <= 8; groupNo++) {
      const images = groupsByCategory[category][groupNo];
      // CSVの各グループの5行目（9枚の中央）を固定画像とする
      // 1～4行目、6～9行目の計8枚を比較画像としてランダムな順番で提示する
      const fixedImage = images[4];
     
// 比較画像8枚を取得（5枚目の固定画像を除く）
const baseComparisonImages = [
  ...images.slice(0, 4),
  ...images.slice(5)
];

// 被験者番号から16通りの順番を決定
const participantNumber = Number(participantId.slice(1));
const orderNumber = (participantNumber - 1) % 16;

// 1～8番：正順
// 9～16番：逆順
const orderedImages = orderNumber < 8
  ? baseComparisonImages
  : [...baseComparisonImages].reverse();

// 8枚の表示開始位置を決定
const offset = orderNumber % 8;

// 最終的な表示順
const comparisonImages = [
  ...orderedImages.slice(offset),
  ...orderedImages.slice(0, offset)
];


      comparisonImages.forEach((comparisonImage, i) => {
        const fixedSide = i % 2 === 0 ? "left" : "right";
        const left = fixedSide === "left" ? fixedImage : comparisonImage;
        const right = fixedSide === "right" ? fixedImage : comparisonImage;

        allTrials.push({
          category,
          groupNo,
          groupTrial: i + 1,
          fixedImage,
          comparisonImage,
          fixedSide,
          leftImage: left,
          rightImage: right
        });
      });
    }
  }
  return allTrials;
}

startButton.addEventListener("click", async () => {
  const input = document.getElementById("participantId");
  const number = Number(input.value);

  if (input.value.trim() === "" || !Number.isInteger(number) || number < 1) {
    alert("被験者番号を正しく入力してください。");
    input.focus();
    return;
  }

  participantId = "P" + String(number).padStart(3, "0");
  startButton.disabled = true;
  statusText.textContent = "画像・グループ・音声対応表を確認しています...";

  try {
    const [groups, mapping] = await Promise.all([
      loadGroupAssignments(),
      loadAudioMapping()
    ]);
    groupsByCategory = groups;
audioMapping = mapping;

const audioImages = new Set(
  Object.values(groupsByCategory[AUDIO_CATEGORY]).flat()
);

for (const imageName of audioImages) {
  if (!audioMapping.has(imageName)) {
    throw new Error(
      `音声ありカテゴリの${imageName}に音声が割り当てられていません。`
    );
  }
}

// 対応表に余分な画像があっても無視する

trials = buildTrials();

if (trials.length !== 192) {
  throw new Error("試行数が192ではありません。");
}
    startScreen.hidden = true;
    experiment.hidden = false;
    statusText.textContent = "";
    trialIndex = 0;
    results = [];
    showTrial();
  } catch (error) {
    statusText.textContent = "準備中にエラーが発生しました: " + error.message;
    startButton.disabled = false;
    console.error(error);
  }
});

function stopAudio() {
  clearTimeout(audioStopTimer);
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

function setRatingEnabled(enabled) {
  ratingButtons.forEach(button => button.disabled = !enabled);
}

// カテゴリ間の画面を表示
function showCategoryTransition(nextCategory) {
  experiment.hidden = true;
  categoryTransition.hidden = false;

  categoryTransitionTitle.textContent =
    `${CATEGORY_LABELS[nextCategory]}に進みます`;

  categoryTransitionMessage.textContent =
    `次は「${CATEGORY_LABELS[nextCategory]}」の画像比較を行います。`;
}

// 次のカテゴリへ進むボタン
nextCategoryButton.addEventListener("click", () => {
  categoryTransition.hidden = true;
  experiment.hidden = false;

  showTrial();
});

function showTrial() {
  stopAudio();

  currentTrial = trials[trialIndex];

  // 評価ボタンを無効化
  setRatingEnabled(false);
  // 音声関連の表示をリセット
leftSpeaker.hidden = true;
rightSpeaker.hidden = true;
audioReplayButton.hidden = true;
audioReplayButton.disabled = false;
audioStatus.textContent = "";

  // 画像・進行状況を一旦非表示
  pairArea.hidden = true;
  progressText.textContent = "";

  // 注視点だけを表示
  fixation.hidden = false;

  const t = currentTrial;

  // 1秒後に画像を表示
  window.setTimeout(() => {

    // 注視点を消す
    fixation.hidden = true;

    // 進行状況を表示
    progressText.textContent =
      `${CATEGORY_LABELS[t.category]}｜${t.groupNo}グループ｜${t.groupTrial}/8試行　（全${trialIndex + 1}/192試行）`;

    // 左右の画像を表示
    pairArea.hidden = false;

    leftImage.src = IMAGE_FOLDER + t.leftImage;
    rightImage.src = IMAGE_FOLDER + t.rightImage;

    // 音声ありカテゴリの場合
    if (t.category === AUDIO_CATEGORY) {
      playPairAudio(t);
    } else {
      audioStatus.textContent = "";
      setRatingEnabled(true);
    }

  }, FIXATION_MS);
}


async function playOneAudio(imageName) {
  const audioName = audioMapping.get(imageName);
  if (!audioName) throw new Error(`音声が見つかりません: ${imageName}`);

  stopAudio();
  const audio = new Audio(AUDIO_FOLDER + audioName);
  audio.volume = 0.5;
  currentAudio = audio;

  await audio.play();
  await new Promise(resolve => {
    audioStopTimer = window.setTimeout(() => {
      stopAudio();
      resolve();
    }, AUDIO_PLAY_MS);
  });
}

// 左右の音声を順番に再生
// 左右の音声を順番に再生
async function playPairAudio(trial) {

  // すでに再生中なら処理しない
  if (isPlayingAudio) return;

  isPlayingAudio = true;

  // 再生中は評価できないようにする
  setRatingEnabled(false);

  // 再生ボタンを無効化
  audioReplayButton.hidden = true;
  audioReplayButton.disabled = true;

  // スピーカーマークを消す
  leftSpeaker.hidden = true;
  rightSpeaker.hidden = true;

  try {

    // ① 左側の音声
    audioStatus.textContent = "左側の音声を再生しています...";
    leftSpeaker.hidden = false;

    await playOneAudio(trial.leftImage);

    // 左側の音声終了
    leftSpeaker.hidden = true;

    // ② 0.5秒間の無音
    audioStatus.textContent = "次の音声を再生します...";
    await new Promise(resolve => setTimeout(resolve, 500));

    // ③ 右側の音声
    audioStatus.textContent = "右側の音声を再生しています...";
    rightSpeaker.hidden = false;

    await playOneAudio(trial.rightImage);

    // 右側の音声終了
    rightSpeaker.hidden = true;

    // ④ 再生終了
    audioStatus.textContent =
      "音声の再生が終了しました。画像を評価してください。音声が流れない場合はもう一度聞くボタンを押してください。";

    // 評価ボタンを有効化
    setRatingEnabled(true);

    // もう一度聞くボタンを表示
    audioReplayButton.hidden = false;
    audioReplayButton.disabled = false;

  } catch (error) {

    stopAudio();

    leftSpeaker.hidden = true;
    rightSpeaker.hidden = true;

    audioStatus.textContent =
      "音声を再生できませんでした。音声ファイルを確認してください。";

    console.error(error);

    setRatingEnabled(true);

    audioReplayButton.hidden = false;
    audioReplayButton.disabled = false;

  } finally {

    // ★ 成功・失敗に関係なく再生中フラグを解除
    isPlayingAudio = false;

  }
}

// もう一度聞くボタン
audioReplayButton.addEventListener("click", () => {

  if (!currentTrial || audioReplayButton.disabled) return;

  playPairAudio(currentTrial);

});

ratingButtons.forEach(button => {
  button.addEventListener("click", () => {
    if (button.disabled || !currentTrial) return;

    const score = Number(button.dataset.score);
    const t = currentTrial;

    results.push({
      participantId,
      category: t.category,
      categoryName: CATEGORY_LABELS[t.category],
      groupNo: t.groupNo,
      groupTrial: t.groupTrial,
      overallTrial: trialIndex + 1,
      fixedImage: t.fixedImage,
      comparisonImage: t.comparisonImage,
      fixedSide: t.fixedSide,
      leftImage: t.leftImage,
      rightImage: t.rightImage,
      score,
      answer: score > 0 ? "左" : score < 0 ? "右" : "どちらともいえない"
    });

   trialIndex++;

if (trialIndex < trials.length) {

  // 次の試行のカテゴリを確認
  const nextCategory = trials[trialIndex].category;

  // カテゴリが切り替わる場合
  if (nextCategory !== t.category) {
    showCategoryTransition(nextCategory);
  } else {
    showTrial();
  }

} else {
  // 全192試行が終了
  finishExperiment();
}
  });
});

async function finishExperiment() {
  stopAudio();
  experiment.hidden = true;
  statusText.textContent = "回答を送信しています...";

  try {
    await fetch(WEB_APP_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(results)
    });

    statusText.textContent = "";
    completeScreen.hidden = false;
    completeMessage.textContent =
      `${results.length}試行分の送信処理が終了しました。スプレッドシートに保存された結果を確認してください。`;
  } catch (error) {
    statusText.textContent = "送信に失敗しました。管理者に連絡してください。";
    console.error(error);
  }
}
