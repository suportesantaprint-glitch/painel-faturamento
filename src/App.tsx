import React, { FormEvent, useEffect, useMemo, useState } from "react";
import "./App.css";
import { supabase } from "./src/supabase";

type Faturamento = {
  id: number;
  descricao: string;
  valor: number;
  data: string;
  criado_em?: string;
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dataAtual = new Date().toISOString().slice(0, 10);

export default function App() {
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(dataAtual);

  const [faturamentos, setFaturamentos] = useState<Faturamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const total = useMemo(
    () => faturamentos.reduce((acc, item) => acc + Number(item.valor), 0),
    [faturamentos]
  );

  async function carregarFaturamentos() {
    setCarregando(true);
    setErro("");

    const { data, error } = await supabase
      .from("faturamentos")
      .select("*")
      .order("data", { ascending: false });

    if (error) {
      setErro(error.message);
    } else {
      setFaturamentos(data ?? []);
    }

    setCarregando(false);
  }

  useEffect(() => {
    carregarFaturamentos();
  }, []);

  async function salvarFaturamento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const valorNumerico = Number(valor);

    if (!descricao.trim()) {
      setErro("Informe uma descrição.");
      return;
    }

    if (!Number.isFinite(valorNumerico) || valorNumerico <= 0) {
      setErro("Informe um valor válido.");
      return;
    }

    setErro("");
    setSalvando(true);

    const { data: novoItem, error } = await supabase
      .from("faturamentos")
      .insert([
        {
          descricao: descricao.trim(),
          valor: valorNumerico,
          data,
        },
      ])
      .select()
      .single();

    if (error) {
      setErro(error.message);
      setSalvando(false);
      return;
    }

    setFaturamentos((lista) => [novoItem, ...lista]);

    setDescricao("");
    setValor("");
    setData(dataAtual);

    setSalvando(false);
  }

  async function excluirFaturamento(id: number) {
    const confirmar = window.confirm(
      "Deseja realmente excluir este lançamento?"
    );

    if (!confirmar) return;

    const { error } = await supabase
      .from("faturamentos")
      .delete()
      .eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    setFaturamentos((lista) => lista.filter((item) => item.id !== id));
  }

  return (
    <main className="pagina">
      <section className="card">
        <h1>Controle de Faturamento</h1>
        <p className="subtitulo">Dados armazenados no Supabase</p>

        <form className="formulario" onSubmit={salvarFaturamento}>
          <label>
            Descrição
            <input
              type="text"
              value={descricao}
              onChange={(e) => {
                setDescricao(e.target.value);
                setErro("");
              }}
              placeholder="Ex.: Serviço mensal"
              required
            />
          </label>

          <label>
            Valor (R$)
            <input
              type="number"
              step="0.01"
              min="0"
              value={valor}
              onChange={(e) => {
                setValor(e.target.value);
                setErro("");
              }}
              placeholder="0,00"
              required
            />
          </label>

          <label>
            Data
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              required
            />
          </label>

          <button type="submit" disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </form>

        {erro && <p className="erro">{erro}</p>}

        <div className="resumo">
          <p>
            <strong>Total:</strong> {moeda.format(total)}
          </p>

          <p>
            <strong>Lançamentos:</strong> {faturamentos.length}
          </p>
        </div>

        <h2>Lançamentos</h2>

        {carregando ? (
          <p>Carregando...</p>
        ) : faturamentos.length === 0 ? (
          <p>Nenhum lançamento cadastrado.</p>
        ) : (
          <ul className="lista">
            {faturamentos.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.descricao}</strong>
                  <br />
                  <small>
                    {new Date(item.data).toLocaleDateString("pt-BR")}
                  </small>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "center",
                  }}
                >
                  <span>{moeda.format(item.valor)}</span>

                  <button
                    type="button"
                    onClick={() => excluirFaturamento(item.id)}
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
