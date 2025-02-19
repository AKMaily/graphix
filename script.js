// Globale Variablen
let cy;
let configData = null;
const LONG_PRESS_DURATION = 1000; // 1s
let rightClickTimer = null;
let leftClickTimer = null;
let connectionMode = false;
let connectionSource = null;
let tempEdge = null;
let tempTarget = null;
let mouseMoveHandler = null;
let edgeIdCounter = 1;

// Speichert HTML-Overlays pro Node (Key: Node-ID)
const nodeOverlays = {};

// Ermittelt die aktuelle Config aus Cytoscape (Nodes & Edges)
function getCurrentConfig() {
    const nodes = [];
    cy.nodes().forEach(node => {
        nodes.push({
            id: node.id(),
            topic: node.data('topic'),
            link: node.data('link'),
            checked: node.data('checked'),
            position: node.position()
        });
    });
    const edges = [];
    cy.edges().forEach(edge => {
        edges.push({
            id: edge.id(),
            source: edge.data('source'),
            target: edge.data('target')
        });
    });
    return { nodes, edges };
}

// Speichert die Config im LocalStorage
function saveConfig() {
    const config = getCurrentConfig();
    localStorage.setItem('graphConfig', JSON.stringify(config));
}

// Erzeugt das HTML-Overlay für einen Node
function createOverlayForNode(node) {
    const cyContainer = document.getElementById('cy');
    const overlay = document.createElement('div');
    overlay.className = 'node-overlay';
    overlay.id = 'overlay-' + node.id();

    // Titel (Thema)
    const titleDiv = document.createElement('div');
    titleDiv.className = 'node-title';
    titleDiv.textContent = node.data('topic');
    overlay.appendChild(titleDiv);

    // Container für Buttons
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'node-buttons';

    // Checkbox-Button
    const checkboxBtn = document.createElement('button');
    checkboxBtn.className = 'checkbox-button';
    checkboxBtn.textContent = node.data('checked') ? '✔' : '☐';
    checkboxBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const newVal = !node.data('checked');
        node.data('checked', newVal);
        checkboxBtn.textContent = newVal ? '✔' : '☐';
        // Aktualisiere Overlay-Hintergrundfarbe: grün = abgeschlossen, rot = nicht abgeschlossen
        overlay.style.backgroundColor = newVal ? '#4caf50' : '#f44336';
        saveConfig();
    });
    buttonsDiv.appendChild(checkboxBtn);

    // Plus-Button (zum Erstellen eines neuen Knotens)
    const plusBtn = document.createElement('button');
    plusBtn.className = 'plus-button';
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openNodeModal('create', node.id());
    });
    buttonsDiv.appendChild(plusBtn);

    // Link-Button (öffnet den hinterlegten Link)
    const linkBtn = document.createElement('button');
    linkBtn.className = 'link-button';
    linkBtn.textContent = 'Link';
    linkBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (node.data('link')) {
            window.open(node.data('link'), '_blank');
        }
    });
    buttonsDiv.appendChild(linkBtn);

    overlay.appendChild(buttonsDiv);
    cyContainer.appendChild(overlay);
    nodeOverlays[node.id()] = overlay;
    updateOverlayPosition(node.id());
}

// Aktualisiert die Position eines Overlays anhand der gerenderten Node-Position
function updateOverlayPosition(nodeId) {
    const node = cy.getElementById(nodeId);
    const overlay = nodeOverlays[nodeId];
    if (!node || !overlay) return;
    const pos = node.renderedPosition();
    const width = overlay.offsetWidth;
    const height = overlay.offsetHeight;
    overlay.style.left = (pos.x - width / 2) + 'px';
    overlay.style.top = (pos.y - height / 2) + 'px';
}

// Aktualisiert alle Overlays
function updateAllOverlays() {
    for (let id in nodeOverlays) {
        updateOverlayPosition(id);
    }
}

// Initialisiert Cytoscape und erstellt Overlays
function initCytoscape(config) {
    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [
            ...config.nodes.map(n => ({
                data: {
                    id: n.id,
                    topic: n.topic,
                    link: n.link,
                    checked: n.checked
                },
                position: n.position || undefined
            })),
            ...config.edges.map(e => ({
                data: {
                    id: e.id,
                    source: e.source,
                    target: e.target
                }
            }))
        ],
        style: [
            {
                selector: 'node',
                style: {
                    'shape': 'ellipse',
                    'background-color': 'transparent', // unsichtbar – Overlay übernimmt Darstellung
                    'width': 120,
                    'height': 120,
                    'label': ''
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 3,
                    'line-color': '#bbb',
                    'target-arrow-color': '#bbb',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier'
                }
            },
            {
                selector: '.tempEdge',
                style: {
                    'line-color': 'blue',
                    'line-style': 'dashed',
                    'target-arrow-color': 'blue'
                }
            }
        ],
        layout: {
            name: 'dagre',
            rankDir: 'LR',
            nodeSep: 50,
            edgeSep: 10,
            rankSep: 100,
            animate: false
        },
        wheelSensitivity: 0.2,
        userPanningEnabled: true
    });

    // Erzeuge für jeden Node ein Overlay und setze dessen Farbe
    cy.nodes().forEach(node => {
        createOverlayForNode(node);
        const overlay = nodeOverlays[node.id()];
        overlay.style.backgroundColor = node.data('checked') ? '#4caf50' : '#f44336';
    });

    // Aktualisiere Overlays bei Zoom/Pan
    cy.on('render', updateAllOverlays);
    cy.on('pan zoom', updateAllOverlays);

    // Drag-Handling: Langer Linksklick aktiviert Verschieben
    cy.nodes().on('mousedown', function (e) {
        if (e.originalEvent.button === 0) {
            leftClickTimer = setTimeout(() => {
                e.target.grabify();
            }, LONG_PRESS_DURATION);
        }
    });
    cy.nodes().on('mouseup', function (e) {
        clearTimeout(leftClickTimer);
        e.target.ungrabify();
    });

    // Verbindungserstellung: Langer Rechtsklick (1s) und Ziehen
    cy.nodes().on('cxtmousedown', function (e) {
        if (e.originalEvent.button === 2) {
            rightClickTimer = setTimeout(() => {
                connectionMode = true;
                connectionSource = e.target;
                tempTarget = cy.add({
                    group: 'nodes',
                    data: { id: 'tempTarget', temp: true },
                    position: e.position
                });
                tempEdge = cy.add({
                    group: 'edges',
                    data: { id: 'tempEdge', source: connectionSource.id(), target: 'tempTarget', temp: true },
                    classes: 'tempEdge'
                });
                mouseMoveHandler = function (evt) {
                    const rect = cy.container().getBoundingClientRect();
                    const pos = {
                        x: evt.clientX - rect.left,
                        y: evt.clientY - rect.top
                    };
                    const cyPos = cy.renderer().projectIntoViewport(pos.x, pos.y);
                    tempTarget.position(cyPos);
                };
                document.addEventListener('mousemove', mouseMoveHandler);
            }, LONG_PRESS_DURATION);
            e.originalEvent.preventDefault();
        }
    });
    cy.nodes().on('cxtmouseup', function (e) {
        clearTimeout(rightClickTimer);
        if (connectionMode) {
            let target = e.target;
            if (target && target.isNode() && target.id() !== connectionSource.id() && !target.data('temp')) {
                const newEdgeId = getNextEdgeId();

                cy.add({
                    group: 'edges',
                    data: { id: newEdgeId, source: connectionSource.id(), target: target.id() }
                });
                saveConfig();
            }
            if (tempEdge) { tempEdge.remove(); tempEdge = null; }
            if (tempTarget) { tempTarget.remove(); tempTarget = null; }
            document.removeEventListener('mousemove', mouseMoveHandler);
            connectionMode = false;
            connectionSource = null;
        }
    });
    // Globale Variablen für den Edge-Erstellungsmodus
    let edgeCreationMode = false;
    let edgeCreationSource = null;

    // Event-Listener für den "Kante hinzufügen"-Button
    document.getElementById('addEdgeBtn').addEventListener('click', function () {
        edgeCreationMode = true;
        edgeCreationSource = null; // Zurücksetzen
        alert("Kanten-Modus: Klicken Sie zuerst auf den Ausgangsknoten, dann auf den Zielknoten.");
    });

    // Event-Listener auf alle Nodes: Wenn im Edge-Erstellungsmodus, dann:
    cy.on('tap', 'node', function (e) {
        if (edgeCreationMode) {
            if (!edgeCreationSource) {
                // Erster Klick: Ausgangsknoten festlegen
                edgeCreationSource = e.target;
                // Optional: Visuelles Feedback, z.B. Knoten hervorheben
                edgeCreationSource.style('border-color', '#ffeb3b');
                edgeCreationSource.style('border-width', '4px');
            } else {
                // Zweiter Klick: Zielknoten festlegen
                const target = e.target;
                if (target.id() === edgeCreationSource.id()) {
                    alert("Ausgangs- und Zielknoten dürfen nicht identisch sein!");
                    return;
                }
                // Entferne ggf. das visuelle Highlight vom Ausgangsknoten
                edgeCreationSource.style('border-color', '');
                edgeCreationSource.style('border-width', '');
                // Neue Kante erstellen
                const newEdgeId = getNextEdgeId();

                cy.add({
                    group: 'edges',
                    data: {
                        id: newEdgeId,
                        source: edgeCreationSource.id(),
                        target: target.id()
                    }
                });
                saveConfig();
                alert("Kante hinzugefügt!");
                // Edge-Erstellungsmodus zurücksetzen
                edgeCreationMode = false;
                edgeCreationSource = null;
            }
            e.stopPropagation();
        }
    });

    // Falls der Nutzer auf den leeren Bereich (Canvas) klickt, während der Edge-Modus aktiv ist:
    cy.on('tap', function (e) {
        if (edgeCreationMode && e.target === cy) {
            edgeCreationMode = false;
            if (edgeCreationSource) {
                // Entferne das visuelle Highlight, falls gesetzt
                edgeCreationSource.style('border-color', '');
                edgeCreationSource.style('border-width', '');
            }
            alert("Kanten-Modus abgebrochen.");
        }
    });

    cy.on('cxttap', 'edge', function (evt) {
        if (!connectionMode) {
            const edge = evt.target;
            if (confirm("Kante löschen?")) {
                edge.remove();
                saveConfig();
                // Zustände zurücksetzen:
                connectionMode = false;
                connectionSource = null;
                edgeCreationMode = false;
                edgeCreationSource = null;
                // Optional: Layout neu berechnen und fitten:
                cy.layout({
                    name: 'dagre',
                    rankDir: 'LR',
                    nodeSep: 50,
                    edgeSep: 10,
                    rankSep: 100,
                    animate: false
                }).run();
                cy.fit(cy.elements(), 50);
            }
        }
    });

    // Rechtsklick auf einen Node: Öffnet das Bearbeitungsmodal
    cy.nodes().on('cxttap', function (e) {
        e.preventDefault();
        openNodeModal('edit', e.target.id());
    });
}

// Modal-Funktionen
function openNodeModal(mode, nodeIdOrParent) {
    const modal = document.getElementById('nodeModal');
    const title = document.getElementById('modalTitle');
    const topicInput = document.getElementById('nodeTopic');
    const linkInput = document.getElementById('nodeLink');
    const nodeIdInput = document.getElementById('modalNodeId');
    const parentIdInput = document.getElementById('modalParentId');
    const modeInput = document.getElementById('modalMode');

    modal.style.display = 'flex';
    modeInput.value = mode;
    if (mode === 'edit') {
        title.textContent = "Node bearbeiten";
        const node = cy.getElementById(nodeIdOrParent);
        topicInput.value = node.data('topic');
        linkInput.value = node.data('link') || "";
        nodeIdInput.value = node.id();
        parentIdInput.value = "";
    } else if (mode === 'create') {
        title.textContent = "Neuen Node erstellen";
        topicInput.value = "";
        linkInput.value = "";
        nodeIdInput.value = "";
        parentIdInput.value = nodeIdOrParent; // Hier wird der Parent korrekt übernommen
        console.log("Creating new node with parent:", nodeIdOrParent); // Debug-Ausgabe
    }
}

function closeNodeModal() {
    document.getElementById('nodeModal').style.display = 'none';
}

function getNextEdgeId() { // to generate ids 
    let maxId = 0;
    cy.edges().forEach(edge => {
        const idNum = parseInt(edge.id().substring(1)); // Annahme: ID beginnt mit "e"
        if (idNum > maxId) maxId = idNum;
    });
    return 'e' + (maxId + 1);
}

function getNextNodeId() {
    let maxId = 0;
    cy.nodes().forEach(node => {
        const idNum = parseInt(node.id().substring(1)); // Annahme: ID beginnt mit "n"
        if (idNum > maxId) maxId = idNum;
    });
    return 'n' + (maxId + 1);
}



document.getElementById('modalClose').addEventListener('click', closeNodeModal);
document.getElementById('modalCancel').addEventListener('click', closeNodeModal);

document.getElementById('nodeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const mode = document.getElementById('modalMode').value;
    const topic = document.getElementById('nodeTopic').value;
    const link = document.getElementById('nodeLink').value;
    if (mode === 'edit') {
        const nodeId = document.getElementById('modalNodeId').value;
        const node = cy.getElementById(nodeId);
        node.data('topic', topic);
        node.data('link', link);
        // Aktualisiere Overlay
        const overlay = nodeOverlays[nodeId];
        if (overlay) {
            overlay.querySelector('.node-title').textContent = topic;
        }
    } else if (mode === 'create') {
        const parentId = document.getElementById('modalParentId').value;
        const newId = getNextNodeId();
        const pos = { x: 100 + cy.nodes().length * 150, y: 200 };
        const newNode = cy.add({
            group: 'nodes',
            data: { id: newId, topic: topic, link: link, checked: false },
            position: pos
        });
        newNode.style('background-color', '#f44336');
        createOverlayForNode(newNode);
        // Verbinde den neuen Knoten mit dem Parent
        const newEdgeId = getNextEdgeId();

        cy.add({
            group: 'edges',
            data: { id: newEdgeId, source: parentId, target: newId }
        });
    }
    saveConfig();
    closeNodeModal();
});

// Config Export / Import
document.getElementById('exportConfigBtn').addEventListener('click', function () {
    const config = getCurrentConfig();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "config.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
});

document.getElementById('importConfigBtn').addEventListener('click', function () {
    document.getElementById('importConfigInput').click();
});

document.getElementById('importConfigInput').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
        try {
            const importedConfig = JSON.parse(reader.result);
            if (!importedConfig.nodes || !importedConfig.edges) {
                alert("Config hat das falsche Format");
                return;
            }
            localStorage.setItem('graphConfig', JSON.stringify(importedConfig));
            location.reload();
        } catch (err) {
            alert("Config hat das falsche Format");
        }
        e.target.value = '';
    };
    reader.readAsText(file);
});

// Config laden und Graph initialisieren
function loadConfig() {
    const stored = localStorage.getItem('graphConfig');
    if (stored) {
        configData = JSON.parse(stored);
        initCytoscape(configData);
    } else {
        fetch('config.json')
            .then(response => response.json())
            .then(data => {
                configData = data;
                initCytoscape(configData);
                saveConfig();
            })
            .catch(err => {
                console.error("Fehler beim Laden der config.json:", err);
            });
    }
}

document.addEventListener('DOMContentLoaded', loadConfig);
