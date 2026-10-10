// ============================================================
// dialogUI.js — 任务界面（DOM 层）
//
//  1. 对话面板：NPC 多行台词，E / 点击逐行推进；
//  2. 手机来电弹窗：显示来电人+内容，E 接听（自动接取任务）；
//  3. 任务结果弹窗：成功（自动消失）/ 失败（R 重试 / X 放弃）；
//  4. 事件提示横幅：任务关键节点的顶部提示文字。
// ============================================================

export class DialogUI {
  constructor() {
    // 对话面板
    this.dialog = document.getElementById('quest-dialog');
    this.dialogName = document.getElementById('quest-dialog-name');
    this.dialogText = document.getElementById('quest-dialog-text');
    // 来电
    this.phone = document.getElementById('quest-phone');
    this.phoneCaller = document.getElementById('quest-phone-caller');
    this.phoneText = document.getElementById('quest-phone-text');
    // 结果弹窗
    this.result = document.getElementById('quest-result');
    this.resultTitle = document.getElementById('quest-result-title');
    this.resultDesc = document.getElementById('quest-result-desc');
    this.resultBtns = document.getElementById('quest-result-btns');
    // 横幅
    this.banner = document.getElementById('quest-banner');

    this.lines = [];
    this.lineIdx = 0;
    this.onDialogEnd = null;
    this.onResultChoice = null;

    // 点击也能推进对话
    this.dialog.addEventListener('click', () => this.advance());
    document.getElementById('quest-result-retry').addEventListener('click', () => this._choose('retry'));
    document.getElementById('quest-result-abandon').addEventListener('click', () => this._choose('abandon'));
  }

  // ---------------- 对话 ----------------
  /** 打开对话（lines 为台词数组，结束回调 onEnd） */
  showDialog(lines, onEnd) {
    this.lines = lines;
    this.lineIdx = 0;
    this.onDialogEnd = onEnd || null;
    this.dialog.classList.remove('hidden');
    this._renderLine();
  }

  _renderLine() {
    const line = this.lines[this.lineIdx] || '';
    const sep = line.indexOf('：');
    this.dialogName.textContent = sep > 0 ? line.slice(0, sep) : '';
    this.dialogText.textContent = sep > 0 ? line.slice(sep + 1) : line;
  }

  /** 推进对话，全部播完返回 true */
  advance() {
    if (this.dialog.classList.contains('hidden')) return false;
    this.lineIdx++;
    if (this.lineIdx >= this.lines.length) {
      this.dialog.classList.add('hidden');
      const cb = this.onDialogEnd;
      this.onDialogEnd = null;
      cb && cb();
      return true;
    }
    this._renderLine();
    return true;
  }

  get isDialogOpen() {
    return !this.dialog.classList.contains('hidden');
  }

  // ---------------- 手机来电 ----------------
  showPhone(caller, text) {
    this.phoneCaller.textContent = caller;
    this.phoneText.textContent = text;
    this.phone.classList.remove('hidden');
  }

  hidePhone() {
    this.phone.classList.add('hidden');
  }

  get isPhoneOpen() {
    return !this.phone.classList.contains('hidden');
  }

  // ---------------- 结果弹窗 ----------------
  /** success: true=成功（自动消失） false=失败（R重试/X放弃） */
  showResult(success, title, desc, onChoice) {
    this.resultTitle.textContent = title;
    this.resultTitle.className = success ? 'result-success' : 'result-fail';
    this.resultDesc.textContent = desc;
    this.resultBtns.style.display = success ? 'none' : 'flex';
    this.result.classList.remove('hidden');
    this.onResultChoice = onChoice || null;

    if (success) {
      setTimeout(() => {
        this.result.classList.add('hidden');
      }, 3500);
    }
  }

  _choose(choice) {
    if (this.result.classList.contains('hidden')) return;
    this.result.classList.add('hidden');
    const cb = this.onResultChoice;
    this.onResultChoice = null;
    cb && cb(choice);
  }

  /** 键盘选择（R / X），返回是否消费了按键 */
  handleKey(code) {
    if (this.result.classList.contains('hidden')) return false;
    if (this.resultBtns.style.display === 'none') return false;
    if (code === 'KeyR') { this._choose('retry'); return true; }
    if (code === 'KeyX') { this._choose('abandon'); return true; }
    return false;
  }

  get isResultOpen() {
    return !this.result.classList.contains('hidden');
  }

  // ---------------- 事件横幅 ----------------
  showBanner(text, seconds = 3) {
    this.banner.textContent = text;
    this.banner.classList.remove('hidden');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.add('hidden'), seconds * 1000);
  }
}
