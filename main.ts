import {
	Plugin,
	WorkspaceLeaf,
	FileView,
	MarkdownRenderer,
	TFile,
	Component,
	setIcon,
	Notice,
} from "obsidian";

interface JupyterNotebookSettings {
	renderOutputs: boolean;
	maxOutputHeight: number;
}

const DEFAULT_SETTINGS: JupyterNotebookSettings = {
	renderOutputs: true,
	maxOutputHeight: 500,
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

// Create a helper function for DOM sanitization that both classes can use
function createSanitizedElements(node: Node, component: Component): Node {
	const allowedTags = new Set([
		"div",
		"span",
		"p",
		"br",
		"pre",
		"code",
		"table",
		"thead",
		"tbody",
		"tr",
		"td",
		"th",
		"img",
	]);
	const allowedAttrs = new Set([
		"class",
		"id",
		"src",
		"alt",
		"width",
		"height",
	]);

	if (node.nodeType === Node.TEXT_NODE) {
		return createEl("span", {
			text: node.textContent || "",
		});
	}

	if (node.nodeType === Node.ELEMENT_NODE) {
		const el = node as Element;
		const tagName = el.tagName.toLowerCase();

		if (!allowedTags.has(tagName)) {
			return createEl("span", {
				text: el.textContent || "",
			});
		}

		const newEl = createEl(tagName as keyof HTMLElementTagNameMap);

		// Copy allowed attributes
		Array.from(el.attributes).forEach((attr) => {
			if (allowedAttrs.has(attr.name)) {
				newEl.setAttribute(attr.name, attr.value);
			}
		});

		// Recursively process child nodes
		el.childNodes.forEach((child) => {
			newEl.appendChild(createSanitizedElements(child, component));
		});

		return newEl;
	}

	return createEl("span");
}

// Add this helper function at the top level
function findImageData(output: JupyterOutput): string | null {
	const possibleLocations = {
		directPng: output.data?.["image/png"],
		directJpeg: output.data?.["image/jpeg"],
		metadataPng: output.metadata?.["image/png"],
		metadataJpeg: output.metadata?.["image/jpeg"],
		jupyterData: output.data?.["application/x-jupyter-data"]?.["image/png"],
		jupyterMetadata: output.metadata?.jupyter?.["image/png"],
		reprPng: output.data?._repr_png_,
		metadataReprPng: output.metadata?._repr_png_,
		imageField: output.data?.image,
		metadataImage: output.metadata?.image,
		dataField: output.data?.data?.["image/png"],
		_dataField: output.data?._data?.["image/png"],
		rawData: output.data?.raw,
		metadataRaw: output.metadata?.raw,
	};

	return (
		possibleLocations.directPng ||
		possibleLocations.directJpeg ||
		possibleLocations.metadataPng ||
		possibleLocations.metadataJpeg ||
		possibleLocations.jupyterData ||
		possibleLocations.jupyterMetadata ||
		possibleLocations.reprPng ||
		possibleLocations.metadataReprPng ||
		possibleLocations.imageField ||
		possibleLocations.metadataImage ||
		possibleLocations.dataField ||
		possibleLocations._dataField ||
		possibleLocations.rawData ||
		possibleLocations.metadataRaw ||
		null
	);
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
		try {
			const content = await this.app.vault.read(file);
			const notebook = JSON.parse(content) as JupyterNotebook;
			await this.renderNotebook(notebook);
			this.file = file;
		} catch (e) {
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
		});

		// Convert markdown content
		const markdownText = cell.source.join("");

		await MarkdownRenderer.renderMarkdown(
			markdownText,
			markdownContent,
			this.file?.path || "",
			this
		);

		// Add click handlers for internal links using DOM API
		markdownContent
			.querySelectorAll("a.internal-link")
			.forEach((link: HTMLElement) => {
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

		// Store original cell state
		const originalCell = getCell();
		const originalElements = Array.from(container.childNodes).map((node) =>
			node.cloneNode(true)
		);

		// Create edit textarea
		const textarea = container.createEl("textarea", {
			cls: ["cell-editor", "auto-resize"],
		});
		textarea.value = originalCell.content.join("");

		// Add auto-resize functionality
		const adjustHeight = () => {
			textarea.classList.add("adjusting");
			textarea.classList.remove("adjusting");
		};

		textarea.addEventListener("input", adjustHeight);
		requestAnimationFrame(adjustHeight);

		// Clear container and show editor
		container.empty();
		container.appendChild(textarea);

		// Add save/cancel buttons
		const buttonContainer = container.createDiv("editor-buttons");

		const saveButton = buttonContainer.createEl("button", {
			text: "Save",
			cls: ["editor-button", "save-button"],
		});

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
			cls: ["editor-button", "cancel-button"],
		});

		const enableEditButton = () => {
			editButton.removeClass("disabled");
		};

		// Handle save
		saveButton.onclick = async () => {
			const newContent = textarea.value;
			await this.saveNotebookChanges(
				originalCell,
				newContent,
				cellElement
			);
			enableEditButton();
		};

		// Handle cancel - restore original content
		cancelButton.onclick = () => {
			container.empty();
			// Restore original content using cloned nodes
			originalElements.forEach((element) => {
				container.appendChild(element.cloneNode(true));
			});
			enableEditButton();
		};
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
		setIcon(toggleButton, "chevron-down");

		// Create output div
		const outputDiv = outputContainer.createDiv({
			cls: ["output-cell", "expanded"],
		});

		// Add click handler for toggle
		toggleButton.addEventListener("click", () => {
			const isCollapsed = outputDiv.classList.contains("collapsed");

			if (isCollapsed) {
				outputDiv.classList.remove("collapsed");
				outputDiv.classList.add("expanded");
				toggleButton.classList.remove("collapsed");
				setIcon(toggleButton, "chevron-down");
			} else {
				outputDiv.classList.remove("expanded");
				outputDiv.classList.add("collapsed");
				toggleButton.classList.add("collapsed");
				setIcon(toggleButton, "chevron-right");
			}
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

		// Handle IPython Image object
		const text = output.data["text/plain"]?.join("") || "";
		if (text.includes("IPython.core.display.Image")) {
			const imageData = findImageData(output);

			if (imageData) {
				const imgDiv = wrapper.createDiv("image-container");
				imgDiv.createEl("img", {
					cls: "output-image",
					attr: {
						src: `data:image/png;base64,${imageData}`,
					},
				});
			} else {
				wrapper.createDiv({
					cls: "image-placeholder",
					text: "Image data not available",
				});
			}
			return wrapper;
		}

		// Handle direct image data
		if (output.data["image/png"] || output.data["image/jpeg"]) {
			const imgDiv = wrapper.createDiv("image-container");
			imgDiv.createEl("img", {
				cls: "output-image",
				attr: {
					src: `data:image/${
						output.data["image/png"] ? "png" : "jpeg"
					};base64,${
						output.data["image/png"] || output.data["image/jpeg"]
					}`,
				},
			});
			return wrapper;
		}

		// Handle HTML output
		if (output.data["text/html"]) {
			const htmlDiv = wrapper.createDiv({
				cls: "html-output",
			});

			const parser = new DOMParser();
			const doc = parser.parseFromString(
				output.data["text/html"].join(""),
				"text/html"
			);

			const sanitizedContent = createSanitizedElements(doc.body, this);
			htmlDiv.appendChild(sanitizedContent);

			return wrapper;
		}

		// Handle plain text
		if (output.data["text/plain"]) {
			const pre = wrapper.createEl("pre", {
				cls: "plain-text-output",
			});
			pre.createEl("code", {
				text: output.data["text/plain"].join(""),
			});
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
	settings: JupyterNotebookSettings;

	async onload() {
		this.registerView(
			"ipynb",
			(leaf: WorkspaceLeaf) => new JupyterView(leaf)
		);

		this.registerExtensions(["ipynb"], "ipynb");

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
							const pre = codeDiv.createEl("pre");
							pre.createEl("code", {
								text: cell.source.join(""),
								cls: "language-python",
							});

							// Render outputs if they exist and settings allow
							if (
								cell.outputs?.length &&
								this.settings.renderOutputs
							) {
								const outputsDiv = cellDiv.createDiv({
									cls: "cell-outputs",
								});
								for (const output of cell.outputs) {
									await this.renderPreviewOutput(
										output,
										outputsDiv
									);
								}
							}
						} else if (cell.cell_type === "markdown") {
							const mdDiv = cellDiv.createDiv({
								cls: "markdown-cell",
							});
							await MarkdownRenderer.renderMarkdown(
								cell.source.join(""),
								mdDiv,
								ctx.sourcePath,
								this
							);
						}
					}

					// Replace embed with preview
					embed.replaceWith(previewContainer);
				} catch (error) {
					console.error("Preview Notebook Failed:", error);
					embed.createDiv({
						cls: "jupyter-preview-error",
						text:
							"Error loading notebook preview: " + error.message,
					});
				}
			}
		});

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

	onunload() {}

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

	// Update the renderPreviewOutput method
	private async renderPreviewOutput(
		output: JupyterOutput,
		container: HTMLElement
	) {
		const outputDiv = container.createDiv("output-wrapper");

		if (output.output_type === "stream") {
			outputDiv.createEl("pre", {
				text: output.text?.join("") || "",
				cls: `stream-output ${output.name || "stdout"}`,
			});
		} else if (
			output.output_type === "execute_result" ||
			output.output_type === "display_data"
		) {
			const text = output.data?.["text/plain"]?.join("") || "";
			if (text.includes("IPython.core.display.Image")) {
				const imageData = findImageData(output);

				if (imageData) {
					const imgDiv = outputDiv.createDiv("image-container");
					imgDiv.createEl("img", {
						cls: "output-image",
						attr: {
							src: `data:image/png;base64,${imageData}`,
						},
					});
				} else {
					outputDiv.createDiv({
						cls: "image-placeholder",
						text: "Image data not available",
					});
				}
			} else if (output.data?.["text/html"]) {
				const htmlDiv = outputDiv.createDiv({
					cls: "html-output",
				});

				const parser = new DOMParser();
				const doc = parser.parseFromString(
					output.data["text/html"].join(""),
					"text/html"
				);

				const sanitizedContent = createSanitizedElements(
					doc.body,
					this
				);
				htmlDiv.appendChild(sanitizedContent);
			} else if (output.data?.["text/plain"]) {
				// Restore plain text output handling
				outputDiv.createEl("pre", {
					text: output.data["text/plain"].join(""),
					cls: "plain-text-output",
				});
			}
		} else if (output.output_type === "error") {
			const errorDiv = outputDiv.createDiv("error-output");
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
		}
	}
}
