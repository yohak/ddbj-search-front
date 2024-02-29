import { Link } from "@tanstack/react-router";
import { clsx } from "clsx";
import { FC, useMemo } from "react";
import { FormattedDate, FormattedMessage, FormattedTime } from "react-intl";
import { API_BASE_URL } from "@/constants";
import { TailwindElementProps } from "@/types";

type Props = {
  item: any;
};

export const SearchResultCard: FC<Props> = ({ item }) => {
  // console.log(item);
  const title = item.title || item.description || item.name;
  const detailUrl = useMemo(
    () => `./${item.type}/${item.identifier}`,
    [item.identifier, item.type]
  );
  const refsCount = item.dbXrefs.length;

  const groups = useMemo(
    () =>
      Object.entries(
        item.dbXrefs.reduce(
          (result: any, dbXref: any) => ({
            ...result,
            [dbXref.type]: (result[dbXref.type] || 0) + 1,
          }),
          {}
        )
      ).map(([type, count]: any) => ({ type, count })),
    [item]
  );
  return (
    <Wrapper href={detailUrl}>
      <Tags identifier={item.identifier} type={item.type} />
      <Title title={title} className={"-mt-2"} />
      <Related className="text-sm">
        <FormattedMessage id="etnry.related_entry.message" values={{ refsCount }} />
      </Related>
      <div className="flex justify-between">
        <BadgeWrapper>
          {groups.map((group) => (
            <Badge key={group.type}>
              {group.type} : {group.count}
            </Badge>
          ))}
        </BadgeWrapper>
        {item.datePublished && <DatePublished datePublished={item.datePublished} />}
      </div>
    </Wrapper>
  );
};

export const SkeletonSearchResultCard: FC<TailwindElementProps> = ({ children, className }) => {
  return (
    <div className={clsx("h-8 rounded-md border border-gray-200 bg-gray-100", className)}>
      {children}
    </div>
  );
};

const Wrapper: FC<TailwindElementProps & { href: string }> = ({ href, children, className }) => {
  return (
    <Link
      className={clsx(
        "flex flex-col gap-2 rounded-md border border-gray-200 p-2 hover:text-primary-dark",
        className
      )}
      to={href}
    >
      {children}
    </Link>
  );
};

const Tags: FC<TailwindElementProps & { identifier: string; type: string }> = ({
  identifier,
  type,
}) => {
  return (
    <div className="flex gap-2 text-sm">
      <span>{identifier}</span>
      <span>{type}</span>
    </div>
  );
};

const Title: FC<TailwindElementProps & { title: string }> = ({ title, className }) => {
  return <h3 className={clsx("text-2xl leading-tight", className)}>{title}</h3>;
};

const Related: FC<TailwindElementProps> = ({ children, className }) => {
  return <h4 className={clsx("text-sm", className)}>{children}</h4>;
};

const BadgeWrapper: FC<TailwindElementProps> = ({ children, className }) => {
  return <div className={clsx("flex gap-1", className)}>{children}</div>;
};

const Badge: FC<TailwindElementProps> = ({ children, className }) => {
  return (
    <span className={clsx("rounded bg-gray-100 p-1 text-xs font-bold text-gray-900", className)}>
      {children}
    </span>
  );
};

const DatePublished: FC<TailwindElementProps & { datePublished: string }> = ({
  datePublished,
  className,
}) => {
  return (
    <div className={clsx("flex gap-2 text-sm", className)}>
      <span>
        <FormattedMessage id="entry.published_at" />
      </span>
      <time className="flex gap-2" dateTime={datePublished}>
        <span>
          <FormattedDate value={datePublished} />
        </span>
        <span>
          <FormattedTime value={datePublished} />
        </span>
      </time>
    </div>
  );
};
