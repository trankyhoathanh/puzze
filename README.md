# 1. Clone repository
git clone git@github.com:trankyhoathanh/puzze.git
cd puzze

# 2. Install dependencies
yarn

# 3. Configure environment
cp env .env
# Edit .env and add your DeepSeek API key
# DEEPSEEK_API_KEY=your_actual_api_key_here

# 4. Configure word size (optional)
# Edit src/wordle-solver.service.ts and update:
# private readonly WORD_SIZE = 5; // or your desired length
1. Clone env to .env

# 5. Start the server
yarn start:dev

http
GET http://localhost:3000/play/daily

Uses DeepSeek AI for intelligent guessing
Dynamic prompt engineering
Loop detection and recovery
Best for complex word patterns

http
GET http://localhost:3000/smart/play/daily

Optimized algorithm with minimal API calls
Fixed number of requests: Math.ceil(26/WORD_SIZE) + X
Vowel prioritization strategy
Consistent performance

🚀 Features
Dual Strategies: Choose between AI and algorithmic solving

Adaptive Learning: Improves guesses based on feedback

Error Resilient: Handles API failures and retries

Configurable: Easy to adjust for different word lengths

Efficient: Minimizes external API calls

📋 Requirements
Node.js 16+
Yarn or NPM
DeepSeek API key
Internet connection (for external APIs)

🔍 Debugging
Check console for detailed logs:
Each guess and response
API call counters
Algorithm decisions
Final solution and stats

📝 License
MIT License - feel free to use and modify!

<img width="827" height="820" alt="Screenshot 2025-09-14 at 06 33 22" src="https://github.com/user-attachments/assets/df400c30-8a1f-454f-8d01-96b790827b34" />
