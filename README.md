# ⚡ acheron

> A native terminal user interface workbench for local AI model orchestration.

Acheron is a minimalist, local-first TUI designed to orchestrate and stress-test interactive loops between local large language models (an Executor and a Critic setup).

---

## 🛰️ Features

* **Native TUI Workspace:** Built entirely with React and Ink for a responsive, clean terminal UI layout.
* **Dual-Agent Orchestration:** Real-time feedback loop tracking interactions between Executor and Critic agents.
* **Local-First Architecture:** Keeps your data on your machine—engineered to connect seamlessly with local Ollama instances running open-source models like `llama` and `qwen`.

## 🛠️ Prerequisites

Before installing Acheron, ensure you have the following installed:

* **Node.js** (v22 or higher recommended)
* **Ollama** (running locally with your preferred models pulled)
  ```bash
  ollama run qwen
  ollama run llama3
