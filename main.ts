import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	FileView,
	MarkdownRenderer,
	TFile,
	ViewCreator,
	Component,
	ViewPlugin,
	ViewUpdate,
	Decoration,
} from "obsidian";
import { EditorView } from "@codemirror/view";

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: "default",
};

// Add these interfaces for Jupyter notebook structure
interface JupyterNotebook {
	cells: JupyterCell[];
	metadata: any;
	nbformat: number;
	nbformat_minor: number;
}

interface JupyterCell {
	cell_type: "code" | "markdown" | "raw";
	source: string[];
	metadata: any;
	outputs?: JupyterOutput[];
}

interface JupyterOutput {
	output_type: string;
	data?: {
		"text/plain"?: string[];
		"text/html"?: string[];
		"image/png"?: string;
		"image/jpeg"?: string;
		"application/json"?: any;
		[key: string]: any;
	};
	metadata?: {
		[key: string]: any;
	};
	text?: string[];
	name?: string;
	ename?: string;
	evalue?: string;
	traceback?: string[];
}

// Add this interface to handle edits
interface EditableCell {
	type: "code" | "markdown";
	content: string[];
	outputs?: JupyterOutput[];
}

// Create a custom view for Jupyter notebooks
class JupyterView extends FileView {
	private notebook: JupyterNotebook;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return "ipynb";
	}

	getDisplayText(): string {
		return this.file?.basename || "Jupyter Notebook";
	}

	getIcon(): string {
		return "document";
	}

	async onOpen() {
		if (this.file) {
			await this.onLoadFile(this.file);
		}
	}

	async onLoadFile(file: TFile): Promise<void> {
		console.log("Loading file:", file.path);
		try {
			const content = await this.app.vault.read(file);
			const notebook = JSON.parse(content) as JupyterNotebook;
			await this.renderNotebook(notebook);
			this.file = file;
		} catch (e) {
			console.error("Error loading notebook:", e);
			this.contentEl.empty();
			this.contentEl.setText("Error loading notebook: " + e.message);
		}
	}

	private async renderCell(
		cell: JupyterCell,
		index: number
	): Promise<HTMLElement> {
		const cellDiv = document.createElement("div");
		cellDiv.className = "jupyter-cell";
		cellDiv.dataset.cellIndex = index.toString();

		// Add cell header
		const cellHeader = this.createCellHeader(cell, cellDiv);
		const editButton = cellHeader.querySelector(
			".cell-edit-button"
		) as HTMLElement;

		// Render cell content based on type
		if (cell.cell_type === "markdown") {
			const markdownDiv = cellDiv.createDiv("markdown-cell");
			await this.renderMarkdownCell(cell, markdownDiv, editButton);
		} else if (cell.cell_type === "code") {
			const codeDiv = cellDiv.createDiv("code-cell");
			await this.renderCodeCell(cell, codeDiv, editButton);
		}

		return cellDiv;
	}

	private async renderNotebook(notebook: JupyterNotebook): Promise<void> {
		this.notebook = notebook;
		this.contentEl.empty();

		const fragment = document.createDocumentFragment();
		for (let i = 0; i < notebook.cells.length; i++) {
			const cellElement = await this.renderCell(notebook.cells[i], i);
			fragment.appendChild(cellElement);
		}

		this.contentEl.appendChild(fragment);
	}

	private createCellHeader(
		cell: JupyterCell,
		cellDiv: HTMLElement
	): HTMLElement {
		const cellHeader = cellDiv.createDiv("cell-header");
		const cellTypeDiv = cellHeader.createDiv("cell-type-indicator");
		cellTypeDiv.setText(`[${cell.cell_type}]`);

		const editButton = cellHeader.createDiv("cell-edit-button");
		editButton.setText("Edit");

		return cellHeader;
	}

	private async renderMarkdownCell(
		cell: JupyterCell,
		markdownDiv: HTMLElement,
		editButton: HTMLElement
	) {
		// Create a content-editable div for markdown content
		const markdownContent = markdownDiv.createDiv({
			cls: "markdown-content",
			attr: { contenteditable: "true" },
		});

		// Convert markdown content to support Obsidian links
		const markdownText = cell.source.join("");

		// Render markdown with Obsidian's link processor
		await MarkdownRenderer.renderMarkdown(
			markdownText,
			markdownContent,
			this.file?.path || "", // Pass the file path for link resolution
			this
		);

		// Add click handlers for internal links
		const links = markdownContent.querySelectorAll("a.internal-link");
		links.forEach((link) => {
			link.addEventListener("click", (evt) => {
				evt.preventDefault();
				const href = link.getAttribute("data-href");
				if (href) {
					this.app.workspace.openLinkText(
						href,
						this.file?.path || ""
					);
				}
			});
		});

		// Add edit handler for markdown
		editButton.onclick = () => {
			this.editCell(
				() => this.getCurrentCell(markdownDiv),
				markdownContent
			);
		};
	}

	private async renderCodeCell(
		cell: JupyterCell,
		codeDiv: HTMLElement,
		editButton: HTMLElement
	) {
		const inputDiv = codeDiv.createDiv("input-area");
		const codeWrapper = inputDiv.createDiv("code-wrapper");

		// Create line numbers and code content containers
		const [lineNumbersContainer, codeContainer] =
			this.createCodeContainers(codeWrapper);

		// Get and render code content
		const codeContent = cell.source.join("");
		await this.renderCodeContent(
			codeContent,
			codeContainer,
			lineNumbersContainer
		);

		// Add edit handler
		editButton.onclick = () => {
			this.editCell(() => this.getCurrentCell(inputDiv), inputDiv);
		};

		// Render outputs if they exist
		if (cell.outputs?.length) {
			await this.renderOutputs(cell.outputs, codeDiv);
		}
	}

	private createCodeContainers(
		wrapper: HTMLElement
	): [HTMLElement, HTMLElement] {
		const lineNumbers = wrapper.createDiv("line-numbers");
		const codeContent = wrapper.createDiv("code-content");
		return [lineNumbers, codeContent];
	}

	private async renderCodeContent(
		content: string,
		container: HTMLElement,
		lineNumbers: HTMLElement
	): Promise<void> {
		const codeText = ["```python", content.trim(), "```"].join("\n");

		await MarkdownRenderer.renderMarkdown(
			codeText,
			container,
			this.file?.path || "",
			this
		);

		this.enhanceCodeBlock(container, lineNumbers);
	}

	private enhanceCodeBlock(
		container: HTMLElement,
		lineNumbers: HTMLElement
	): void {
		const preElement = container.querySelector("pre");
		if (!preElement) return;

		preElement.addClass("jupyter-code-block");
		const codeElement = preElement.querySelector("code");
		if (!codeElement) return;

		codeElement.addClass("language-python");
		codeElement.setAttribute("spellcheck", "false");

		this.addLineNumbers(codeElement, lineNumbers);
		this.syncLineNumbersScroll(codeElement, lineNumbers);
	}

	private addLineNumbers(
		codeElement: HTMLElement,
		lineNumbers: HTMLElement
	): void {
		const lines = codeElement.textContent?.split("\n") || [];
		lineNumbers.empty();

		const fragment = document.createDocumentFragment();
		lines.forEach((_, index) => {
			const lineNumber = document.createElement("div");
			lineNumber.className = "line-number";
			lineNumber.textContent = (index + 1).toString();
			fragment.appendChild(lineNumber);
		});

		lineNumbers.appendChild(fragment);
	}

	private syncLineNumbersScroll(
		codeElement: HTMLElement,
		lineNumbers: HTMLElement
	): void {
		const scrollHandler = () => {
			lineNumbers.scrollTop = codeElement.scrollTop;
		};

		codeElement.addEventListener("scroll", scrollHandler);
	}

	private getCurrentCell(container: HTMLElement): EditableCell {
		const cellElement = container.closest(".jupyter-cell") as HTMLElement;
		if (!cellElement) {
			throw new Error("Could not find jupyter-cell element");
		}
		const cellIndex = parseInt(cellElement.dataset.cellIndex || "0", 10);
		const notebookCell = this.notebook.cells[cellIndex];
		return {
			type: notebookCell.cell_type as "code" | "markdown",
			content: notebookCell.source,
			outputs: notebookCell.outputs,
		};
	}

	private editCell(getCell: () => EditableCell, container: HTMLElement) {
		const cellElement = container.closest(".jupyter-cell") as HTMLElement;
		if (!cellElement) return;

		// Get the edit button
		const editButton = cellElement.querySelector(
			".cell-edit-button"
		) as HTMLElement;

		// Disable edit button while editing
		editButton.addClass("disabled");
		editButton.style.opacity = "0.5";
		editButton.style.pointerEvents = "none";

		// Store original content and cell
		const originalContent = container.innerHTML;
		const cell = getCell();

		// Create edit textarea
		const textarea = container.createEl("textarea", {
			cls: "cell-editor",
		});
		textarea.value = cell.content.join("");

		// Add auto-resize functionality
		const adjustHeight = () => {
			textarea.style.height = "auto";
			textarea.style.height = textarea.scrollHeight + "px";
		};

		// Adjust height initially and on input
		textarea.addEventListener("input", adjustHeight);
		setTimeout(adjustHeight, 0);

		// Clear container and show editor
		container.empty();
		container.appendChild(textarea);

		// Add save/cancel buttons
		const buttonContainer = container.createDiv("editor-buttons");

		const saveButton = buttonContainer.createEl("button", {
			text: "Save",
			cls: "editor-button save-button",
		});

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
			cls: "editor-button cancel-button",
		});

		const enableEditButton = () => {
			editButton.removeClass("disabled");
			editButton.style.opacity = "";
			editButton.style.pointerEvents = "";
		};

		// Handle save
		saveButton.onclick = async () => {
			const newContent = textarea.value;
			await this.saveNotebookChanges(cell, newContent, cellElement);
			enableEditButton();
		};

		// Handle cancel - restore original content
		cancelButton.onclick = () => {
			container.empty();
			container.innerHTML = originalContent;
			enableEditButton();
		};
	}

	// Add a helper method to sanitize HTML
	private sanitizeHtml(html: string): string {
		// Basic sanitization - you might want to use a proper HTML sanitizer library
		return html
			.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
			.replace(/on\w+="[^"]*"/g, "");
	}

	async onClose() {
		this.contentEl.empty();
	}

	// Add this method to JupyterView class to save changes to file
	private async saveNotebookChanges(
		cell: EditableCell,
		newContent: string,
		cellElement: HTMLElement
	) {
		if (!this.file) return;

		try {
			// Read current notebook content
			const content = await this.app.vault.read(this.file);
			const notebook = JSON.parse(content) as JupyterNotebook;

			// Find the cell index
			const cells = this.contentEl.querySelectorAll(".jupyter-cell");
			let cellIndex = -1;
			cells.forEach((el, index) => {
				if (el.contains(cellElement)) {
					cellIndex = index;
				}
			});

			if (cellIndex === -1) return;

			// Update the cell content
			notebook.cells[cellIndex].source = newContent
				.split("\n")
				.map((line, i, arr) => {
					return i < arr.length - 1 ? line + "\n" : line;
				});

			// Save the updated notebook
			await this.app.vault.modify(
				this.file,
				JSON.stringify(notebook, null, 2)
			);

			// Update the in-memory notebook reference
			this.notebook = notebook;

			// Re-render just this cell
			if (cell.type === "markdown") {
				const markdownDiv = cellElement.querySelector(
					".markdown-cell"
				) as HTMLElement;
				const editButton = cellElement.querySelector(
					".cell-edit-button"
				) as HTMLElement;

				markdownDiv.empty();
				await this.renderMarkdownCell(
					notebook.cells[cellIndex],
					markdownDiv,
					editButton
				);
			} else {
				const inputDiv = cellElement.querySelector(
					".input-area"
				) as HTMLElement;
				inputDiv.empty();

				// Create code wrapper and containers
				const codeWrapper = inputDiv.createDiv("code-wrapper");
				const [lineNumbersContainer, codeContainer] =
					this.createCodeContainers(codeWrapper);

				// Render code content with line numbers
				await this.renderCodeContent(
					newContent,
					codeContainer,
					lineNumbersContainer
				);
			}

			new Notice("Changes saved successfully");
		} catch (e) {
			console.error("Error saving notebook:", e);
			new Notice("Error saving notebook: " + e.message);
		}
	}

	private async renderOutputs(
		outputs: JupyterOutput[],
		parentDiv: HTMLElement
	): Promise<void> {
		const outputContainer = parentDiv.createDiv("output-container");

		// Create toggle button first
		const toggleButton = outputContainer.createDiv("output-toggle");
		toggleButton.innerHTML = "▼";

		// Create output div with initial collapsed state
		const outputDiv = outputContainer.createDiv({
			cls: "output-cell",
		});

		// Add click handler for toggle
		toggleButton.addEventListener("click", () => {
			outputDiv.classList.toggle("collapsed");
			toggleButton.classList.toggle("collapsed");
			toggleButton.innerHTML = outputDiv.classList.contains("collapsed")
				? "▶"
				: "▼";
		});

		// Render outputs
		const fragment = document.createDocumentFragment();
		for (const output of outputs) {
			const outputWrapper = this.createOutputWrapper(output);
			if (outputWrapper) {
				fragment.appendChild(outputWrapper);
			}
		}
		outputDiv.appendChild(fragment);
	}

	private createOutputWrapper(output: JupyterOutput): HTMLElement | null {
		const wrapper = document.createElement("div");
		wrapper.className = "output-wrapper";

		switch (output.output_type) {
			case "stream":
				return this.createStreamOutput(output, wrapper);
			case "execute_result":
			case "display_data":
				return this.createRichOutput(output, wrapper);
			case "error":
				return this.createErrorOutput(output, wrapper);
			default:
				return null;
		}
	}

	private createStreamOutput(
		output: JupyterOutput,
		wrapper: HTMLElement
	): HTMLElement {
		const pre = wrapper.createEl("pre", {
			text: output.text?.join("") || "",
			cls: `stream-output ${output.name || "stdout"}`,
		});
		return wrapper;
	}

	private createRichOutput(
		output: JupyterOutput,
		wrapper: HTMLElement
	): HTMLElement {
		if (!output.data) return wrapper;

		// Handle images
		if (output.data["image/png"] || output.data["image/jpeg"]) {
			const imgDiv = wrapper.createDiv("image-container");
			const img = imgDiv.createEl("img", {
				cls: "image-output",
			});
			img.src = `data:image/${
				output.data["image/png"] ? "png" : "jpeg"
			};base64,${output.data["image/png"] || output.data["image/jpeg"]}`;
			return wrapper;
		}

		// Handle HTML output
		if (output.data["text/html"]) {
			const htmlDiv = wrapper.createDiv({
				cls: "html-output",
			});
			const htmlContent = output.data["text/html"].join("");
			const sanitizedHtml = this.sanitizeHtml(htmlContent);
			htmlDiv.innerHTML = sanitizedHtml;

			// Add specific styling for tables
			const tables = htmlDiv.querySelectorAll("table");
			tables.forEach((table) => {
				table.addClass("jupyter-table");
			});
			return wrapper;
		}

		// Handle plain text
		if (output.data["text/plain"]) {
			const textContent = output.data["text/plain"].join("");
			if (textContent.trim()) {
				const pre = wrapper.createEl("pre", {
					cls: "plain-text-output",
				});

				// Render text with Obsidian link support
				MarkdownRenderer.renderMarkdown(
					textContent,
					pre,
					this.file?.path || "",
					this
				);

				// Add click handlers for internal links
				const links = pre.querySelectorAll("a.internal-link");
				links.forEach((link) => {
					link.addEventListener("click", (evt) => {
						evt.preventDefault();
						const href = link.getAttribute("data-href");
						if (href) {
							this.app.workspace.openLinkText(
								href,
								this.file?.path || ""
							);
						}
					});
				});
			}
		}

		return wrapper;
	}

	private createErrorOutput(
		output: JupyterOutput,
		wrapper: HTMLElement
	): HTMLElement {
		const errorDiv = wrapper.createDiv("error-output");

		if (output.ename && output.evalue) {
			errorDiv.createEl("div", {
				text: `${output.ename}: ${output.evalue}`,
				cls: "error-header",
			});
		}

		if (output.traceback) {
			errorDiv.createEl("pre", {
				text: output.traceback.join("\n"),
				cls: "error-traceback",
			});
		}

		return wrapper;
	}
}

// Add this after the JupyterView class
export default class JupyterPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		console.log("Loading Jupyter Notebook plugin");

		// Register the view type with the same name as the file extension
		this.registerView(
			"ipynb",
			(leaf: WorkspaceLeaf) => new JupyterView(leaf)
		);

		// Register extension to use our view
		this.registerExtensions(["ipynb"], "ipynb");

		// Add a command to force open as notebook
		this.addCommand({
			id: "open-as-notebook",
			name: "Open current file as Jupyter Notebook",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (file?.extension === "ipynb") {
					if (!checking) {
						this.openNotebook(file);
					}
					return true;
				}
				return false;
			},
		});

		// Load custom styles
		this.loadStyles();

		// Add Markdown preview processor
		this.registerMarkdownPostProcessor(async (el, ctx) => {
			const embeds = el.querySelectorAll<HTMLElement>(
				'.internal-embed[src$=".ipynb"]'
			);
			if (!embeds.length) return;

			for (const embed of Array.from(embeds)) {
				try {
					const src = embed.getAttribute("src");
					if (!src) continue;

					const file = this.app.metadataCache.getFirstLinkpathDest(
						src,
						ctx.sourcePath
					);
					if (!file) continue;

					const content = await this.app.vault.read(file);
					const notebook = JSON.parse(content) as JupyterNotebook;

					// Create preview container
					const previewContainer = embed.createDiv({
						cls: "jupyter-notebook-preview",
					});

					// Render all cells
					for (const cell of notebook.cells) {
						const cellDiv = previewContainer.createDiv({
							cls: "notebook-cell",
						});

						// Add cell type indicator
						cellDiv.createDiv({
							cls: "cell-type",
							text: cell.cell_type.toUpperCase(),
						});

						if (cell.cell_type === "code") {
							const codeDiv = cellDiv.createDiv({
								cls: "code-cell",
							});
							codeDiv.createEl("pre").createEl("code", {
								text: cell.source.join(""),
								cls: "language-python",
							});

							// Render all outputs
							if (cell.outputs?.length) {
								const outputsDiv = cellDiv.createDiv({
									cls: "cell-outputs",
								});
								for (const output of cell.outputs) {
									await this.renderOutput(output, outputsDiv);
								}
							}
						} else if (cell.cell_type === "markdown") {
							const mdDiv = cellDiv.createDiv({
								cls: "markdown-cell",
							});
							await MarkdownRenderer.render(
								this.app,
								cell.source.join(""),
								mdDiv,
								ctx.sourcePath,
								this
							);
						}
					}

					// Add preview to embed element
					embed.insertAdjacentElement("afterend", previewContainer);
				} catch (error) {
					console.error("Preview Notebook Failed:", error);
				}
			}
		});

		// Add preview styles
		const previewStyle = document.createElement("style");
		previewStyle.textContent = `
			.jupyter-notebook-preview {
				margin: 1em 0;
				padding: 1em;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				background: var(--background-primary);
			}
			.notebook-cell {
				margin-bottom: 1em;
				padding: 0.5em;
				background: var(--background-secondary);
				border-radius: 4px;
			}
			.cell-type {
				color: var(--text-muted);
				font-size: 0.8em;
				margin-bottom: 0.5em;
				text-transform: uppercase;
			}
			.code-cell pre {
				margin: 0;
				padding: 0.5em;
				background: var(--background-primary);
				font-family: var(--font-monospace);
				overflow-x: auto;
			}
			.cell-outputs {
				margin-top: 0.5em;
				padding-left: 0.5em;
				border-left: 2px solid var(--text-accent);
			}
			.output {
				margin-top: 0.5em;
			}
			.output pre {
				margin: 0;
				padding: 0.5em;
				background: var(--background-primary);
				overflow-x: auto;
			}
			.error-output {
				color: var(--text-error);
			}
			.error-traceback {
				margin: 0;
				padding: 0.5em;
				background: var(--background-secondary);
				border-radius: 4px;
			}
			.output img {
				max-width: 100%;
				height: auto;
			}
		`;
		document.head.appendChild(previewStyle);

		// Load settings
		await this.loadSettings();
	}

	async openNotebook(file: TFile) {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (leaf) {
			await leaf.setViewState({
				type: "ipynb",
				state: {
					file: file.path,
				},
			});
		}
	}

	onunload() {
		console.log("Unloading Jupyter Notebook plugin");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private loadStyles() {
		const styleEl = document.createElement("style");
		styleEl.id = "jupyter-notebook-styles";

		styleEl.textContent = `
			/* Jupyter notebook styles */
			.jupyter-cell {
				margin: 1em 0;
				padding: 1em;
				border: 1px solid var(--background-modifier-border);
				width: 100%;
				box-sizing: border-box;
			}

			.cell-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				margin-bottom: 0.5em;
			}

			.cell-type-indicator {
				color: var(--text-muted);
				font-size: 0.8em;
			}

			/* Code block styling */
			.code-cell {
				width: 100%;
				overflow-x: auto;
			}

			.input-area {
				width: 100%;
				overflow-x: auto;
				position: relative;
			}

			.code-wrapper {
				display: flex;
				min-width: fit-content;
				background-color: var(--code-background);
				border-radius: 4px;
			}

			.jupyter-code-block {
				width: 100%;
				margin: 0;
				padding: 0;
				background-color: var(--code-background);
				border-radius: 4px;
				user-select: text;
				-webkit-user-select: text;
			}

			.code-content {
				flex: 1;
				overflow-x: auto;
				min-width: 0;
				position: relative;
			}

			.code-content pre {
				margin: 0;
				padding: 1em;
				min-width: fit-content;
				box-sizing: border-box;
			}

			.code-content code {
				white-space: pre;
				word-wrap: normal;
				display: inline-block;
				min-width: 100%;
				user-select: text !important;
				-webkit-user-select: text !important;
				cursor: text;
				font-family: var(--font-monospace);
				line-height: 1.5;
			}

			/* Line numbers */
			.line-numbers {
				padding: 1em 0.5em;
				border-right: 1px solid var(--background-modifier-border);
				background-color: var(--code-background);
				color: var(--text-muted);
				user-select: none;
				-webkit-user-select: none;
				text-align: right;
				min-width: 2.5em;
				position: sticky;
				left: 0;
				z-index: 1;
			}

			.line-number {
				font-family: var(--font-monospace);
				font-size: 0.85em;
				line-height: 1.5;
				height: 1.5em;
				user-select: none;
				-webkit-user-select: none;
			}

			/* Output styling */
			.output-container {
				position: relative;
				margin-top: 0.5em;
				padding-left: 20px;
				width: 100%;
				overflow-x: auto;
			}

			.output-cell {
				max-height: none;
				overflow: visible;
				transition: max-height 0.2s ease;
				width: 100%;
			}

			.output-wrapper {
				padding: 0.5em;
				min-width: fit-content;
				overflow-x: auto;
			}

			.output-cell.collapsed {
				max-height: 100px;
				overflow-y: hidden;
				position: relative;
			}

			/* Scrollbar styling */
			.code-content::-webkit-scrollbar,
			.output-wrapper::-webkit-scrollbar,
			.output-container::-webkit-scrollbar {
				height: 8px;
				width: 8px;
			}

			.code-content::-webkit-scrollbar-track,
			.output-wrapper::-webkit-scrollbar-track,
			.output-container::-webkit-scrollbar-track {
				background: var(--background-modifier-border);
				border-radius: 4px;
			}

			.code-content::-webkit-scrollbar-thumb,
			.output-wrapper::-webkit-scrollbar-thumb,
			.output-container::-webkit-scrollbar-thumb {
				background: var(--text-muted);
				border-radius: 4px;
			}

			/* Plain text output */
			.plain-text-output,
			.stream-output,
			.error-traceback {
				white-space: pre;
				overflow-x: auto;
				min-width: fit-content;
			}

			/* Editor styling */
			.cell-editor {
				width: 100%;
				min-height: 100px;
				resize: vertical;
				padding: 0.5em;
				font-family: var(--font-monospace);
				background-color: var(--code-background);
				color: var(--text-normal);
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
			}

			/* Ensure proper line height matching */
			.language-python {
				line-height: 1.5 !important;
			}

			/* Make code blocks properly selectable */
			.jupyter-code-block pre {
				user-select: text;
				-webkit-user-select: text;
				cursor: text;
			}

			/* Ensure line numbers stay fixed during horizontal scroll */
			.code-wrapper {
				position: relative;
			}

			.line-numbers {
				position: sticky;
				left: 0;
				background-color: var(--code-background);
				z-index: 2;
			}

			/* Add a subtle shadow to indicate scrollable content */
			.code-content::after {
				content: '';
				position: absolute;
				top: 0;
				right: 0;
				bottom: 0;
				width: 30px;
				pointer-events: none;
				background: linear-gradient(to right, transparent, var(--code-background));
				opacity: 0;
				transition: opacity 0.2s;
			}

			.code-content:hover::after {
				opacity: 1;
			}

			/* Base code colors - One Dark Pro inspired */
			.theme-dark .language-python {
				color: #abb2bf;  /* Light gray base text */
			}
			
			.theme-light .language-python {
				color: #383a42;  /* Dark gray base text */
			}

			/* Syntax highlighting - Multiple theme options */
			/* Theme: One Dark Pro */
			.theme-dark .language-python .keyword { 
				color: #c678dd;  /* Purple */
				font-weight: bold;
			}
			
			.theme-dark .language-python .function { 
				color: #61afef;  /* Blue */
				font-weight: 500;
			}
			
			.theme-dark .language-python .string { 
				color: #98c379;  /* Green */
				font-weight: 500;
			}
			
			.theme-dark .language-python .number { 
				color: #d19a66;  /* Orange */
				font-weight: 500;
			}
			
			.theme-dark .language-python .comment { 
				color: #7f848e;  /* Gray */
				font-style: italic;
			}
			
			.theme-dark .language-python .operator { 
				color: #56b6c2;  /* Cyan */
				font-weight: bold;
			}
			
			.theme-dark .language-python .builtin { 
				color: #e5c07b;  /* Light Orange */
				font-weight: 500;
			}
			
			.theme-dark .language-python .class-name { 
				color: #e5c07b;  /* Light Orange */
				font-weight: bold;
			}

			/* Theme: Light - Enhanced contrast */
			.theme-light .language-python .keyword { 
				color: #d32f2f;  /* Darker red */
				font-weight: bold;
			}
			
			.theme-light .language-python .function { 
				color: #5c2b9a;  /* Darker purple */
				font-weight: 500;
			}
			
			.theme-light .language-python .string { 
				color: #0d47a1;  /* Darker blue */
				font-weight: 500;
			}
			
			.theme-light .language-python .number { 
				color: #0046ab;  /* Darker blue */
				font-weight: 500;
			}
			
			.theme-light .language-python .comment { 
				color: #546e7a;  /* Darker gray */
				font-style: italic;
			}
			
			.theme-light .language-python .operator { 
				color: #c62828;  /* Darker red */
				font-weight: bold;
			}
			
			.theme-light .language-python .builtin { 
				color: #004d8c;  /* Darker blue */
				font-weight: 500;
			}
			
			.theme-light .language-python .class-name { 
				color: #4a148c;  /* Darker purple */
				font-weight: bold;
			}

			/* Common styles for both themes */
			.language-python .decorator { 
				color: #e5c07b;  /* Light Orange */
				font-weight: 500;
				font-style: italic;
			}
			
			.language-python .self { 
				color: #e06c75;  /* Soft Red */
				font-style: italic;
				font-weight: 500;
			}
			
			.language-python .parameter { 
				color: #d19a66;  /* Orange */
			}

			/* Code block backgrounds */
			.theme-dark .jupyter-code-block {
				background-color: #282c34;  /* Dark background */
			}
			
			.theme-light .jupyter-code-block {
				background-color: #ffffff;  /* Pure white background */
				border: 1px solid #e0e0e0;  /* Light border for better definition */
			}

			/* Line numbers */
			.theme-dark .line-numbers {
				background-color: #282c34;
				color: #495162;  /* Muted blue-gray */
				border-right: 1px solid #3e4451;
			}
			
			.theme-light .line-numbers {
				background-color: #f8f9fa;  /* Slightly off-white */
				color: #616161;  /* Darker gray for better contrast */
				border-right: 1px solid #e0e0e0;
			}

			/* Add subtle hover effects */
			.jupyter-code-block:hover {
				box-shadow: 0 0 0 1px var(--background-modifier-border);
			}

			/* Improve code readability */
			.code-content code {
				font-family: 'JetBrains Mono', 'Fira Code', 'Source Code Pro', var(--font-monospace);
				font-size: 0.9em;
				letter-spacing: 0.3px;
				line-height: 1.5;
			}

			/* Selection highlight */
			.language-python ::selection {
				background-color: rgba(128, 203, 196, 0.2);
			}

			/* Token hover effect */
			.language-python .token:hover {
				background-color: rgba(255, 255, 255, 0.05);
				border-radius: 2px;
			}

			.output img {
				max-width: 100%;
				height: auto;
				display: block;
				margin: 0.5em 0;
				will-change: opacity;
				contain: content;
			}
			.image-error {
				color: var(--text-error);
				padding: 0.5em;
				background: var(--background-secondary);
				border-radius: 4px;
				margin: 0.5em 0;
			}
			.image-placeholder {
				padding: 1em;
				background: var(--background-secondary);
				border: 1px dashed var(--text-muted);
				border-radius: 4px;
				color: var(--text-muted);
				text-align: center;
				margin: 0.5em 0;
				contain: content;
			}
			.output pre {
				contain: content;
				overflow-x: auto;
			}
		`;

		document.head.appendChild(styleEl);
	}

	private async renderOutput(output: JupyterOutput, container: HTMLElement) {
		// 创建文档片段来减少 DOM 操作
		const fragment = document.createDocumentFragment();
		const outputDiv = fragment.createDiv({ cls: "output" });

		if (output.output_type === "stream") {
			outputDiv.createEl("pre").setText(output.text?.join("") || "");
		} else if (
			output.output_type === "execute_result" ||
			output.output_type === "display_data"
		) {
			// 检查是否是 IPython 图片对象
			const text = output.data?.["text/plain"]?.join("") || "";
			const isIPythonImage = text.includes("IPython.core.display.Image");

			if (isIPythonImage) {
				// 添加详细的调试日志
				console.log("Found IPython Image object");
				console.log("Full output:", output);
				console.log("Data:", output.data);
				console.log("Metadata:", output.metadata);

				// 尝试所有可能的图片数据位置
				let imageData = null;

				// 检查所有可能的数据位置
				const possibleLocations = [
					output.data?.["image/png"],
					output.metadata?.["image/png"],
					output.data?.["application/json"]?.["image/png"],
					output.data?.["image/jpeg"],
					output.data?.["application/x-jupyter-data"]?.["image/png"],
					output.data?.["application/x-jupyter"]?.["image/png"],
				];

				// 记录所有位置的检查结果
				possibleLocations.forEach((location, index) => {
					console.log(
						`Location ${index}:`,
						location ? "Has data" : "No data"
					);
				});

				// 使用第一个有效的数据源
				imageData = possibleLocations.find((data) => data);

				if (imageData) {
					const img = outputDiv.createEl("img", {
						attr: {
							src: `data:image/png;base64,${imageData}`,
							loading: "lazy",
						},
					});
					this.setupImageElement(img);
				} else {
					console.log("No image data found in any location");
					outputDiv.createEl("div", {
						cls: "image-placeholder",
						text: "Image data not available",
					});
				}
			} else if (output.data?.["text/html"]) {
				const parser = new DOMParser();
				const doc = parser.parseFromString(
					output.data["text/html"].join(""),
					"text/html"
				);
				outputDiv.append(...Array.from(doc.body.childNodes));
			} else if (output.data?.["text/plain"]) {
				outputDiv.createEl("pre").setText(text);
			}
		} else if (output.output_type === "error") {
			const errorDiv = outputDiv.createDiv({ cls: "error-output" });
			errorDiv
				.createEl("pre", { cls: "error-traceback" })
				.setText(output.traceback?.join("\n") || "");
		}

		// 一次性添加到容器
		requestAnimationFrame(() => {
			container.appendChild(fragment);
		});
	}

	// 添加辅助方法来设置图片元素
	private setupImageElement(img: HTMLImageElement) {
		img.style.opacity = "0";
		img.addEventListener("load", () => {
			img.style.transition = "opacity 0.3s ease-in";
			img.style.opacity = "1";
		});
		img.addEventListener("error", () => {
			console.error("Failed to load image");
			img.replaceWith(
				createEl("div", {
					text: "Failed to load image",
					cls: "image-error",
				})
			);
		});
	}
}
