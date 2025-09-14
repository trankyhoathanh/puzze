import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { chunk, padStart } from "lodash";

interface GuessResult {
  slot: number;
  guess: string;
  result: string;
}

@Injectable()
export class WordleSolverService {
  private readonly WORDLE_API = 'https://wordle.votee.dev:8000/daily';
  private readonly AI_API = 'https://api.deepseek.com/chat/completions';
  private readonly WORD_SIZE = 18;
  
  private correct: string[] = new Array(this.WORD_SIZE).fill(null);
  private present: Set<string> = new Set();
  private absent: Set<string> = new Set();
  private history: {guess: string, results: GuessResult[]}[] = [];
  private previousGuesses: Set<string> = new Set();

  private async makeGuess(guess: string): Promise<GuessResult[]> {
    const url = `${this.WORDLE_API}?guess=${guess}&size=${this.WORD_SIZE}`;
    const response = await axios.get(url);
    return response.data;
  }

  private analyzeResults(guess: string, results: GuessResult[]): void {
    this.history.push({guess, results});
    this.previousGuesses.add(guess);
    
    results.forEach(result => {
      if (result.result === 'correct') this.correct[result.slot] = result.guess;
      else if (result.result === 'present') this.present.add(result.guess);
      else if (!this.correct.includes(result.guess) && !this.present.has(result.guess)) 
        this.absent.add(result.guess);
    });
  }

  private createAIPrompt(): string {
    // Phân tích trạng thái hiện tại
    const emptySlots = this.correct.map((l, i) => l ? -1 : i).filter(i => i !== -1);
    const movableLetters = Array.from(this.present).filter(l => !this.correct.includes(l));
    
    // Tạo prompt cực ngắn gọn nhưng hiệu quả
    let prompt = `Wordle ${this.WORD_SIZE}L - Opt Guess\n`;
    
    // Pattern hiện tại
    prompt += `Pattern: ${this.correct.map(l => l || '_').join('')}\n`;
    
    // Thông tin quan trọng nhất
    if (movableLetters.length > 0) {
        prompt += `Move: ${movableLetters.join('')}\n`;
    }
    if (emptySlots.length > 0) {
        prompt += `Slots: ${emptySlots.map(s => s + 1).join(',')}\n`;
    }
    
    // Danh sách từ cấm (chỉ 3 từ gần nhất)
    const recentTried = Array.from(this.previousGuesses).slice(-3);
    prompt += `Avoid: ${recentTried.join(',')}\n`;
    
    // Gợi ý cụ thể dựa trên pattern
    prompt += `Suggest: ${this.generateSmartSuggestions()}\n`;
    
    prompt += `Guess:`;
    
    return prompt;
  }

  private generateSmartSuggestions(): string {
    const emptySlots = this.correct.map((l, i) => l ? -1 : i).filter(i => i !== -1);
    const movableLetters = Array.from(this.present).filter(l => !this.correct.includes(l));
    
    const suggestions: string[] = [];
    
    // Gợi ý 1: Nếu ít chữ cái cần di chuyển
    if (movableLetters.length <= 3) {
        suggestions.push(`Rearrange ${movableLetters.join('')}`);
    }
    
    // Gợi ý 2: Nếu có vị trí trống
    if (emptySlots.length > 0) {
        const availableLetters = 'abcdefghijklmnopqrstuvwxyz'
            .split('')
            .filter(c => !this.absent.has(c))
            .slice(0, 5) // Chỉ lấy 5 chữ cái đầu
            .join('');
        suggestions.push(`Try letters: ${availableLetters}`);
    }
    
    return suggestions.join(' | ') || 'New combination';
  }

  private checkLastCharacter(): boolean {
    const lastResult = this.history[this.history.length - 1]?.results;
    if (!lastResult) return false;

    let correctCount = 0;
    for (let h of lastResult) {
        if (h.result === 'correct') correctCount++;
    }

    // Nếu chỉ còn 1 ký tự sai
    if (this.WORD_SIZE - correctCount === 1) {
        console.log('Only 1 character wrong, running exhaustive test...');
        return true;
    }
    
    return false;
  }

  private getInitialGuess(): string {
    // Trả về chuỗi 'a' lặp lại theo WORD_SIZE
    return 'a'.repeat(this.WORD_SIZE);
  }

  private async getAIGuess(): Promise<string> {
    if (this.history.length === 0) return this.getInitialGuess();

    // Kiểm tra loop mạnh mẽ hơn
    const recentGuesses = this.history.slice(-5).map(h => h.guess);
    const uniqueRecent = new Set(recentGuesses);
    const isInLoop = recentGuesses.length >= 3 && uniqueRecent.size <= 2;

    if (isInLoop) {
        console.log('🔄 Loop detected - Using smart emergency guess');
        return this.generateSmartEmergencyGuess();
    }

    const prompt = this.createAIPrompt();
    console.log(prompt)
    
    try {
        const response = await axios.post(this.AI_API, {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: this.WORD_SIZE + 5,
            temperature: 0.4, // Giảm temperature để ổn định hơn
            stop: ['\n', '.']
        }, {
            timeout: 5000, // Timeout ngắn hơn
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        let guess = response.data.choices[0].message.content.trim().toLowerCase();
        
        // Lọc chỉ lấy từ (loại bỏ các ký tự không cần thiết)
        const wordMatch = guess.match(/[a-z]{7}/);
        if (wordMatch) {
            guess = wordMatch[0];
        }
        
        // Kiểm tra trùng lặp
        if (this.previousGuesses.has(guess)) {
            return this.generateSmartEmergencyGuess();
        }
        
        return guess;
        
    } catch (error) {
        return this.generateSmartEmergencyGuess();
    }
  }

  private generateSmartEmergencyGuess(): string {
    // Emergency guess thông minh hơn
    const availableLetters = 'abcdefghijklmnopqrstuvwxyz'
        .split('')
        .filter(c => !this.absent.has(c));
    
    const priorityLetters = Array.from(this.present).filter(l => !this.correct.includes(l));
    
    let bestGuess = '';
    let maxScore = -1;
    
    // Thử 50 tổ hợp ngẫu nhiên, chọn cái tốt nhất
    for (let i = 0; i < 50; i++) {
        let candidate = '';
        let score = 0;
        
        for (let j = 0; j < this.WORD_SIZE; j++) {
            if (this.correct[j]) {
                candidate += this.correct[j];
                score += 2; // Điểm cho vị trí đúng
            } else {
                // Ưu tiên chữ cái cần di chuyển
                if (priorityLetters.length > 0 && Math.random() < 0.7) {
                    const randomPriority = priorityLetters[
                        Math.floor(Math.random() * priorityLetters.length)
                    ];
                    candidate += randomPriority;
                    score += 1; // Điểm cho chữ cái priority
                } else {
                    const randomChar = availableLetters[
                        Math.floor(Math.random() * availableLetters.length)
                    ];
                    candidate += randomChar;
                }
            }
        }
        
        if (!this.previousGuesses.has(candidate) && score > maxScore) {
            maxScore = score;
            bestGuess = candidate;
        }
    }
    
    return bestGuess || this.getFallbackGuess();
  }

  private getFallbackGuess(): string {
    // Smart fallback based on known information
    let guess = '';
    for (let i = 0; i < this.WORD_SIZE; i++) {
      guess += this.correct[i] || this.getBestCandidate(i);
    }
    return guess;
  }

  private getBestCandidate(position: number): string {
    const available = 'abcdefghijklmnopqrstuvwxyz'
      .split('')
      .filter(c => !this.absent.has(c) && !this.correct.includes(c));
    
    return available[Math.floor(Math.random() * available.length)] || 'a';
  }

  private isSolved(): boolean {
    return this.correct.every(l => l !== null);
  }

  private isValidCandidate(candidate: string): boolean {
    // Kiểm tra các chữ cái present phải có trong từ
    for (const presentChar of this.present) {
        if (!candidate.includes(presentChar)) return false;
    }
    
    // Kiểm tra không chứa chữ cái absent
    for (const absentChar of this.absent) {
        if (candidate.includes(absentChar)) return false;
    }
    
    return true;
  }

  private async testExhaustiveOptions(): Promise<string | null> {
    const unknownIndex = this.correct.findIndex(letter => letter === null);
    if (unknownIndex === -1) return null;

    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    
    for (const char of alphabet) {
        if (this.absent.has(char)) continue; // Bỏ qua chữ cái absent

        // Tạo từ candidate bằng cách thay thế ký tự vào vị trí unknown
        const candidate = this.correct.map((letter, index) => 
            index === unknownIndex ? char : letter
        ).join('');

        // Kiểm tra candidate chưa thử và hợp lệ
        if (!this.previousGuesses.has(candidate) && this.isValidCandidate(candidate)) {
            console.log(`Testing exhaustive option: ${candidate}`);
            try {
                const results = await this.makeGuess(candidate);
                this.analyzeResults(candidate, results);
                
                if (this.isSolved()) {
                    return `Solved with exhaustive test: ${candidate}`;
                }
                
                // Nếu không solved, tiếp tục thử ký tự tiếp theo
            } catch (error) {
                console.error(`Error testing ${candidate}:`, error);
                continue;
            }
        }
    }
    
    return null;
  }

  private shouldUsePermutation(): boolean {
    // Kiểm tra nếu tất cả kết quả đều là present (không có correct nào)
    const lastResult = this.history[this.history.length - 1]?.results;
    if (!lastResult) return false;

    const allPresent = lastResult.every(r => r.result === 'present');
    const knownLetters = Array.from(this.present);
    
    // Chỉ dùng hoán vị khi có ít nhất 2 chữ cái known và tất cả đều present
    return allPresent && knownLetters.length >= 2;
  }

  private generatePermutations(letters: string[]): string[] {
      const result: string[] = [];
      
      // Hàm đệ quy sinh hoán vị
      const permute = (arr: string[], m: string[] = []) => {
          if (arr.length === 0) {
              result.push(m.join(''));
          } else {
              for (let i = 0; i < arr.length; i++) {
                  const curr = arr.slice();
                  const next = curr.splice(i, 1);
                  permute(curr.slice(), m.concat(next));
              }
          }
      };
      
      permute(letters);
      return result;
  }

  private async testAllPermutations(): Promise<string | null> {
    const knownLetters = Array.from(this.present);
    
    // Tạo tất cả hoán vị có thể
    const permutations = this.generatePermutations(knownLetters);
    
    console.log(`Testing ${permutations.length} permutations:`, permutations);
    
    for (const candidate of permutations) {
        // Kiểm tra candidate có độ dài đúng và chưa thử
        if (candidate.length === this.WORD_SIZE && !this.previousGuesses.has(candidate)) {
            console.log(`Testing permutation: ${candidate}`);
            
            try {
                const results = await this.makeGuess(candidate);
                this.analyzeResults(candidate, results);
                
                if (this.isSolved()) {
                    return `Solved with permutation: ${candidate}`;
                }
                
                // Nếu tìm thấy thêm correct position, dừng lại
                if (results.some(r => r.result === 'correct')) {
                    console.log(`Found correct position with ${candidate}, continuing...`);
                    break;
                }
                
            } catch (error) {
                console.error(`Error testing ${candidate}:`, error);
                continue;
            }
        }
    }
    
    return null;
  }

  async solve(): Promise<string> {
    for (let attempt = 1; attempt <= 100; attempt++) {
      // Kiểm tra nếu chỉ còn 1 ký tự sai
      if (this.checkLastCharacter()) {
          const exhaustiveResult = await this.testExhaustiveOptions();
          if (exhaustiveResult) return exhaustiveResult;
          
          // Nếu exhaustive test không thành công, quay lại dùng AI
          console.log('Exhaustive test failed, falling back to AI');
      }

      // Ưu tiên 2: Kiểm tra nếu cần dùng hoán vị
      if (this.shouldUsePermutation()) {
          const permResult = await this.testAllPermutations();
          if (permResult) return permResult;
      }
      
      const guess = await this.getAIGuess();
      const results = await this.makeGuess(guess);
      
      console.log(`Attempt ${attempt}: ${guess} →`, results);
      this.analyzeResults(guess, results);

      if (this.isSolved()) {
        return `Solved in ${attempt} attempts: ${this.correct.join('')}`;
      }
    }
    
    return `Failed after 100 attempts. Best guess: ${this.correct.join('')}`;
  }

  //Smart Brute-force
  async solveOptimized(): Promise<string> {
    const VOWELS = ["A", "E", "I", "O", "U"];
    const CONSONANTS = ["B", "C", "D", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "V", "W", "X", "Y", "Z"];
    
    const matchedLetters = new Set<string>();

    // Bước 1: Kiểm tra nguyên âm (giữ nguyên)
    const vowelChunks = chunk(VOWELS, this.WORD_SIZE);
    const vowelResults = await Promise.all(vowelChunks.map(async (chunk) => {
        return await this.makeGuess(padStart(chunk.join(""), this.WORD_SIZE, "A"));
    }));

    vowelResults.forEach(result => {
        result.forEach(feedback => {
            if (feedback.result !== "absent") {
                matchedLetters.add(feedback.guess);
            }
        });
    });

    // Bước 2: Kiểm tra phụ âm ĐỘC LẬP
    const consonantChunks = chunk(CONSONANTS, this.WORD_SIZE);
    const consonantResults = await Promise.all(consonantChunks.map(async (chunk) => {
        // Tạo từ chỉ chứa phụ âm, không trộn với nguyên âm
        const testWord = padStart(chunk.join(""), this.WORD_SIZE, "B"); // Dùng 'B' thay vì 'A'
        return await this.makeGuess(testWord);
    }));

    consonantResults.forEach(result => {
        result.forEach(feedback => {
            if (feedback.result !== "absent") {
                matchedLetters.add(feedback.guess);
            }
        });
    });

    // Bước 3: Tìm vị trí chính xác
    const correctLetters: string[] = new Array(this.WORD_SIZE).fill('');
    const positionResults = await Promise.all(
        [...matchedLetters].map(letter => 
            this.makeGuess(letter.repeat(this.WORD_SIZE))
        )
    );

    positionResults.forEach(result => {
        result.forEach(feedback => {
            if (feedback.result === "correct") {
                correctLetters[feedback.slot] = feedback.guess;
            }
        });
    });

    return correctLetters.join("");
  }
}