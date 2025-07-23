import React, { useState } from "react";

// Utility for batch size
const MAX_BATCH = 20;

// Letters for MCQ
const LETTERS = ["A", "B", "C", "D"];

// Builds a prompt that asks GPT to generate questions directly from the text and cite an excerpt.
function buildPrompt({ text, num, seenQuestions = [] }) {
  return `
You are an educational AI that creates adaptive multiple-choice questions using ONLY the provided course material.
Generate ${num} unique, non-overlapping MCQs that each cover a different section or idea from the text.
Each question must:
- Be answerable based solely on the text.
- Use a supporting excerpt (quote) from the text for the correct answer.

For each question, provide:
- "question": The question text
- "choices": Four plausible answer options (do NOT prefix with A/B/C/D)
- "answer": The correct option letter (A/B/C/D)
- "explanation": 1-2 sentences referencing the excerpt as justification
- "excerpt": The supporting quote/excerpt from the text
- "category": A short topic label

${
  seenQuestions.length > 0
    ? `Do NOT repeat or paraphrase any of the following already-used questions: ${seenQuestions
        .map((q) => `"${q}"`)
        .join(", ")}`
    : ""
}

Output ONLY a JSON array of question objects. Do not add extra commentary or text.

Text:
${text}
`.trim();
}

// Parses the AI's output robustly, only accepting the first [ ... ] JSON array in the response.
function parseQuestions(responseText) {
  const firstBracket = responseText.indexOf("[");
  const lastBracket = responseText.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1) return null;
  try {
    const arr = JSON.parse(responseText.slice(firstBracket, lastBracket + 1));
    // Clean up choices in case they're objects or not strings
    return arr.map((q) => ({
      ...q,
      choices: Array.isArray(q.choices)
        ? q.choices.map(String)
        : [String(q.choices)],
      answer:
        typeof q.answer === "string" ? q.answer.trim().toUpperCase() : "A",
      category: q.category || "general",
      excerpt: q.excerpt || "",
      explanation: q.explanation || "",
    }));
  } catch {
    return null;
  }
}

// Returns true if the user's answer matches the correct letter (A/B/C/D)
function userAnswerCorrect(q, answer) {
  return answer && q.answer && answer.toUpperCase() === q.answer.toUpperCase();
}

// MCQ card component with professional highlight logic
function QuestionCard({ q, idx, onAnswer, userAnswer }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        padding: 24,
        margin: "28px 0",
        boxShadow: "0 2px 14px #e5e7eb",
        maxWidth: 700,
        minWidth: 300,
      }}
    >
      <div style={{ fontSize: 23, fontWeight: 700, marginBottom: 10 }}>
        {q.question}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {q.choices.map((choice, i) => {
          const letter = LETTERS[i];
          let bg = "#f1f5f9",
            color = "#232940",
            fontWeight = 500;

          if (userAnswer) {
            if (userAnswer === q.answer && letter === userAnswer) {
              // Correct and chosen
              bg = "#22c55e";
              color = "#fff";
              fontWeight = 700;
            } else if (userAnswer !== q.answer) {
              if (letter === userAnswer) {
                // User's wrong choice
                bg = "#ef4444";
                color = "#fff";
                fontWeight = 700;
              } else if (letter === q.answer) {
                // Correct answer (not chosen)
                bg = "#22c55e";
                color = "#fff";
                fontWeight = 700;
              }
              // All other buttons stay neutral
            }
          }

          return (
            <button
              key={i}
              disabled={!!userAnswer}
              style={{
                background: bg,
                color,
                fontWeight,
                border: "none",
                borderRadius: 9,
                fontSize: 21,
                padding: "15px 0",
                marginBottom: 0,
                cursor: userAnswer ? "not-allowed" : "pointer",
                transition: "all 0.15s",
                outline: "none",
              }}
              onClick={() => onAnswer(letter)}
              aria-label={`Answer option ${letter}: ${choice}`}
            >
              {choice}
            </button>
          );
        })}
      </div>
      {userAnswer && (
        <>
          <div
            style={{
              marginTop: 18,
              color: userAnswerCorrect(q, userAnswer) ? "#22c55e" : "#ef4444",
              fontWeight: 600,
              fontSize: 18,
            }}
          >
            {userAnswerCorrect(q, userAnswer) ? (
              "Correct!"
            ) : (
              <>
                Incorrect. Correct: <b>{q.answer}</b>
              </>
            )}
            <div
              style={{
                color: "#64748b",
                marginTop: 6,
                fontWeight: 400,
                fontSize: 16,
              }}
            >
              {q.explanation}
            </div>
          </div>
          <div
            style={{
              color: "#475569",
              marginBottom: 3,
              fontSize: 16,
              marginTop: 12,
            }}
          >
            <b>Category:</b>{" "}
            <span style={{ color: "#64748b", fontWeight: 500 }}>
              {q.category}
            </span>
          </div>
          {q.excerpt && (
            <div
              style={{
                color: "#64748b",
                marginBottom: 12,
                fontStyle: "italic",
                fontSize: 15,
              }}
            >
              <b>Source excerpt:</b> <span>{q.excerpt}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [text, setText] = useState("");
  const [num, setNum] = useState(10);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [seenQuestions, setSeenQuestions] = useState([]);

  // Collect all unique categories for filtering
  const allCategories = Array.from(
    new Set(questions.map((q) => q.category || "General"))
  );

  async function handleGenerate() {
    setQuestions([]);
    setAnswers({});
    setSeenQuestions([]);
    setError("");
    setLoading(true);
    try {
      const prompt = buildPrompt({ text, num, seenQuestions: [] });
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
        }),
      });
      const data = await res.json();
      if (!data.choices || !data.choices[0].message.content)
        throw new Error("No response from AI");
      const parsed = parseQuestions(data.choices[0].message.content);
      if (!parsed)
        throw new Error("Failed to parse questions from AI response");
      setQuestions(parsed);
    } catch (e) {
      setError(
        "Failed to generate questions. Check your API key and input. Error: " +
          e.message
      );
    } finally {
      setLoading(false);
    }
  }

  function handleAnswer(idx, ans) {
    setAnswers((a) => ({ ...a, [idx]: ans }));
    setSeenQuestions((prev) => [...prev, questions[idx]?.question]);
  }

  // Progress
  const numAnswered = Object.keys(answers).length;
  const numCorrect = questions.filter(
    (q, i) => answers[i] && userAnswerCorrect(q, answers[i])
  ).length;

  // Filtered questions by category
  const filteredQuestions =
    filterCategory === "All"
      ? questions
      : questions.filter((q) => q.category === filterCategory);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: "32px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: 28,
          borderRadius: 14,
          boxShadow: "0 2px 18px #e0e7ef",
          marginBottom: 32,
          maxWidth: 730,
          width: "97%",
        }}
      >
        <h1
          style={{ fontSize: 36, margin: 0, color: "#1e293b", fontWeight: 800 }}
        >
          InfinitePractice AI <span style={{ fontWeight: 600 }}>(MVP)</span>
        </h1>
        <div style={{ marginTop: 20, marginBottom: 13 }}>
          <label style={{ fontWeight: 700, color: "#334155", fontSize: 20 }}>
            OpenAI API Key:
          </label>
          <input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{
              width: "100%",
              fontSize: 17,
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              padding: 10,
              marginTop: 3,
              marginBottom: 8,
              background: "#f8fafc",
            }}
            autoComplete="off"
          />
        </div>
        <div style={{ marginTop: 15, marginBottom: 13 }}>
          <label style={{ fontWeight: 700, color: "#334155", fontSize: 20 }}>
            Paste Class Notes:
          </label>
          <textarea
            placeholder="Paste class notes or textbook excerpt here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{
              width: "100%",
              minHeight: 110,
              fontSize: 17,
              padding: 12,
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              marginTop: 4,
              background: "#f8fafc",
              resize: "vertical",
            }}
          />
        </div>
        <div
          style={{
            marginBottom: 22,
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <label style={{ fontWeight: 700, color: "#334155", fontSize: 20 }}>
            Number of questions:
          </label>
          <input
            type="range"
            min={1}
            max={MAX_BATCH}
            value={num}
            onChange={(e) => setNum(Number(e.target.value))}
            style={{ width: 120, marginRight: 12 }}
          />
          <span style={{ fontSize: 20, fontWeight: 700 }}>{num}</span>
        </div>
        <button
          style={{
            marginTop: 10,
            width: "100%",
            padding: "15px 0",
            fontSize: 22,
            background: apiKey && text && !loading ? "#3b82f6" : "#cbd5e1",
            color: apiKey && text && !loading ? "#fff" : "#64748b",
            border: "none",
            borderRadius: 8,
            fontWeight: "bold",
            cursor: apiKey && text && !loading ? "pointer" : "not-allowed",
            boxShadow: "0 1px 5px #e0e7ef",
            transition: "background 0.2s",
          }}
          onClick={handleGenerate}
          disabled={!apiKey || !text || loading}
        >
          {loading ? "Generating..." : `Start Practice`}
        </button>
        {error && (
          <div
            style={{
              color: "#dc2626",
              marginTop: 20,
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {questions.length > 0 && (
        <div
          style={{
            background: "#fff",
            borderRadius: 14,
            padding: 22,
            boxShadow: "0 2px 16px #e0e7ef",
            maxWidth: 730,
            width: "97%",
            marginBottom: 40,
          }}
        >
          <div
            style={{
              marginBottom: 12,
              fontSize: 20,
              fontWeight: 700,
              color: "#222",
              display: "flex",
              alignItems: "center",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <span>
              Progress:{" "}
              <span style={{ fontWeight: 500 }}>
                {numAnswered}/{questions.length} answered,
              </span>{" "}
              <span style={{ color: "#22c55e", fontWeight: 700 }}>
                {numCorrect} correct
              </span>
            </span>
            {allCategories.length > 1 && (
              <>
                <label
                  htmlFor="catfilter"
                  style={{ fontSize: 17, marginLeft: 10 }}
                >
                  Filter by category:
                </label>
                <select
                  id="catfilter"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  style={{
                    fontSize: 17,
                    border: "1px solid #cbd5e1",
                    borderRadius: 7,
                    padding: "3px 7px",
                  }}
                >
                  <option value="All">All</option>
                  {allCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {filteredQuestions.map((q, i) => (
            <QuestionCard
              key={i}
              q={q}
              idx={i}
              onAnswer={(ans) => handleAnswer(i, ans)}
              userAnswer={answers[i]}
            />
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 25,
          color: "#64748b",
          fontSize: 15,
          maxWidth: 680,
          textAlign: "center",
        }}
      >
        <i>
          This MVP demo uses your API key and OpenAI GPT-4o to generate live,
          adaptive practice questions. Your key is only used in your browser and
          not stored anywhere.
          <br />
          <br />
          <b>Disclaimer:</b> These questions are generated by artificial
          intelligence based on your uploaded class materials. This tool is in
          beta and may contain errors, inaccuracies, or hallucinations. These
          questions are NOT officially licensed and should not be considered a
          substitute for instructor-provided or official review questions.
          Always verify with trusted course materials.
        </i>
      </div>
    </div>
  );
}
