import { Injectable } from '@nestjs/common';
import axios from 'axios';

interface GuessResult {
  slot: number;
  guess: string;
  result: string;
}

@Injectable()
export class WordleSolverService {
  private readonly WORDLE_API = 'https://wordle.votee.dev:8000/daily';
  private readonly AI_API = 'https://api.deepseek.com/chat/completions';
  private readonly WORD_SIZE = 6;
  
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
    let prompt = `Wordle ${this.WORD_SIZE}-letter. Next guess must be NEW and valid.\n\n`;
    
    // History - concise format
    prompt += `History:\n`;
    this.history.forEach((h, i) => {
        prompt += `${i+1}. "${h.guess}": `;
        prompt += h.results.map(r => {
            if (r.result === 'correct') return `✓${r.guess}`;
            if (r.result === 'present') return `→${r.guess}`;
            return `✗${r.guess}`;
        }).join(' ');
        prompt += '\n';
    });

    // Knowledge - ultra compact
    prompt += `\nKnown:\n`;
    
    // Correct positions
    this.correct.forEach((letter, index) => {
        if (letter) prompt += `Pos${index+1}=${letter} `;
    });

    // Present letters
    if (this.present.size > 0) {
        prompt += `Present:${Array.from(this.present).join('')} `;
    }

    // Absent letters
    if (this.absent.size > 0) {
        prompt += `Absent:${Array.from(this.absent).join('')}`;
    }

    // Tried words - only list, no formatting
    prompt += `\nTried:${Array.from(this.previousGuesses).join(',')}`;

    // Short instructions
    prompt += `\n\nRules: New word, respect above, ${this.WORD_SIZE} letters, English valid.`;
    prompt += `\nResponse: ONLY the word.`;

    return prompt;
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

    const prompt = this.createAIPrompt();
    
    console.log(prompt)
    

    try {
      const response = await axios.post(this.AI_API, {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 5,
        temperature: 0.1
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const guess = response.data.choices[0].message.content.trim().toLowerCase();
      return guess;
      
    } catch (error) {
      return this.getFallbackGuess();
    }
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
}